// Existing investment audit ID → current permitted link → canonical day-document reader.
// No date inference, extraction fallback, source download, or financial rollup.
// Each line also shows its proposed receipt-to-work context from get_vehicle_receipt_work_context (a shared time window
// with photos; never installation, payment, ownership, or who did the work), behind a disclosure.
import Foundation
import Supabase
import SwiftUI

struct ReceiptEvidenceLink: Decodable, Equatable {
    let id: UUID
    let receipt_id: UUID
    let vehicle_id: UUID?
    let status: String
    let retired_at: String?
    let page_date: String?
}

struct ReceiptEvidenceDay: Decodable {
    let date: String?
    let tied: Bool
    let documents: [ReceiptEvidenceDocument]
}

struct ReceiptEvidenceDocument: Decodable {
    let receipt_id: UUID
    let document_id: UUID?
    let date: String?
    let date_source: String?
    let date_basis: JobJSON?
    let document_kind: String?
    let link_basis: String?
    let currency: String?
    let lines: [ReceiptEvidenceLine]

    var currencyText: String {
        guard let currency, currency.range(of: "^[A-Z]{3}$", options: .regularExpression) != nil else {
            return "Not recorded or unreadable"
        }
        return currency
    }
}

struct ReceiptEvidenceLine: Decodable {
    let line_number: Int?
    let description: String?
    let part_number: String?
    let quantity: JobJSON?
    let unit_price: JobJSON?
    let amount: JobJSON?
    let hours: JobJSON?
    let performer: String?
    let line_date: String?
}

struct ReceiptEvidence {
    let document: ReceiptEvidenceDocument
    let readAt: Date
    /// The proposed receipt-to-work context read; nil when that read failed (the receipt itself still shows).
    var work: ReceiptWorkContextRead? = nil

    func workLine(_ number: Int?) -> ReceiptWorkContextLine? {
        work?.lines.first { $0.receipt_id == document.receipt_id && $0.line_number == number }
    }
    func withdrawnWork(_ number: Int?) -> ReceiptWorkWithdrawal? {
        work?.withdrawn.first { $0.receipt_id == document.receipt_id && $0.line_number == number }
    }
}

// get_vehicle_receipt_work_context: current PROPOSED context per receipt line. Frames are only those this account may see
// (the rest are counted in frames_hidden); photographer, printed performer, custodian and holder are separate labelled
// fields; the page is unresolved; withdrawn lines come apart from current ones.
struct ReceiptWorkContextRead: Decodable {
    let visible: Bool
    let tied: Bool
    let lines: [ReceiptWorkContextLine]
    let withdrawn: [ReceiptWorkWithdrawal]
}

struct ReceiptWorkContextLine: Decodable {
    struct Frame: Decodable {
        struct Photographer: Decodable { let attribution: String? }
        let image_id: UUID
        let taken_at: String?
        let photographer: Photographer?
    }
    struct Lineage: Decodable {
        let source_document_table: String?
        let source_document_id: String?
        let line_number: Int?
        let link_basis: String?
        let link_confidence: Double?
        let page_reason: String?
    }
    struct Printed: Decodable {
        let line_date: String?
        let hours: JobJSON?
        let performer: String?
    }
    struct Labelled: Decodable { let value: String? }
    struct Custodian: Decodable { let masked: Bool? }
    struct Judgment: Decodable {
        struct Holder: Decodable { let claimed_by: String? }
        struct Answer: Decodable {
            let visible: String?
            let installed: String?
            let confidence: Double?
            let quote: String?
        }
        let status: String
        let holder: Holder?
        let answer: Answer?
    }
    let evidence_id: UUID
    let receipt_id: UUID
    let line_number: Int?
    let conclusion: String
    let confidence: Double?
    let status: String
    let anchor_date: String?
    let frames: [Frame]
    let frames_hidden: Int
    let lineage: Lineage
    let printed: Printed?
    let printed_performer: Labelled?
    let custodian: Custodian?
    let judgment: Judgment?
}

struct ReceiptWorkWithdrawal: Decodable {
    let receipt_id: UUID
    let line_number: Int?
    let reason: String?
}

enum ReceiptWorkWords {
    static let notAsserted = "Proposed from shared dates only. Not proof of installation, payment, ownership, or who did the work."
    static func conclusion(_ value: String) -> String {
        switch value {
        case "install_window_photographed": return "The zone was photographed in the window after this date"
        case "photographed_after_window": return "The zone was photographed, but only after the window"
        case "no_zone_photo_after_purchase": return "No photo of the zone after this date"
        case "part_zone_unknown": return "The line names nothing a photo would show"
        case "receipt_day_photographed": return "Photos exist on the receipt day"
        case "receipt_day_unphotographed": return "No photos on the receipt day"
        case "work_day_photographed": return "Photos exist on the printed work day"
        case "work_day_unphotographed": return "No photos on the printed work day"
        case "undated_line": return "No date to compare with photos"
        case "not_work_evidence": return "A charge or note, not work"
        default: return JobWords.humanize(value)
        }
    }
    static func withdrawal(_ reason: String?) -> String {
        switch reason {
        case "line_removed": return "the line was removed from the receipt"
        case "receipt_removed": return "the receipt was removed"
        case "receipt_superseded": return "the receipt was superseded by a corrected one"
        case "receipt_duplicate": return "the receipt is a duplicate"
        case "link_retired": return "the receipt is no longer linked to this vehicle"
        default: return "the source was withdrawn"
        }
    }
    static func judgment(_ j: ReceiptWorkContextLine.Judgment) -> String {
        switch j.status {
        case "pending": return "Open: is the part visible in these frames?"
        case "claimed": return "Open, being read" + (j.holder?.claimed_by.map { " by worker \($0) (not a person on the document)" } ?? "")
        default:
            let a = j.answer
            let parts = [a?.visible.map { "visible \(JobWords.humanize($0))" }, a?.installed.map { "installed \(JobWords.humanize($0))" },
                         a?.confidence.map { String(format: "confidence %.2f", $0) }].compactMap { $0 }
            return "Answered, a model's reading (not a sign): " + (parts.isEmpty ? "no detail" : parts.joined(separator: " · "))
        }
    }
}

@MainActor
enum ReceiptEvidenceReaders {
    struct Reads {
        var links: (UUID) async throws -> [ReceiptEvidenceLink] = { id in
            try await SupabaseService.client.from("receipt_vehicle_links")
                .select("id,receipt_id,vehicle_id,status,retired_at,page_date")
                .eq("receipt_id", value: id.uuidString).is("retired_at", value: nil)
                .limit(2).execute().value
        }
        var day: (UUID, String) async throws -> ReceiptEvidenceDay = { vehicle, date in
            try await SupabaseService.client.rpc("get_vehicle_day_documents", params: [
                "p_vehicle_id": vehicle.uuidString, "p_date": date
            ]).execute().value
        }
        var work: (UUID, String) async throws -> ReceiptWorkContextRead = { vehicle, date in
            try await SupabaseService.client.rpc("get_vehicle_receipt_work_context", params: [
                "p_vehicle_id": vehicle.uuidString, "p_page_date": date
            ]).execute().value
        }
    }

    static func load(receipt id: UUID, vehicle: UUID, reads: Reads = Reads(),
                     account: () -> String? = { SupabaseService.currentUserId }) async -> JobLoad<ReceiptEvidence> {
        let requestedAccount = account()
        func current() throws {
            guard !Task.isCancelled, account() == requestedAccount else { throw CancellationError() }
        }
        do {
            let links = try await reads.links(id)
            try current()
            guard links.count == 1, let link = links.first, link.receipt_id == id,
                  link.vehicle_id == vehicle, link.status == "linked", link.retired_at == nil else {
                return unavailable("A current receipt link is missing, withheld, or no longer belongs to this vehicle.")
            }
            guard let date = link.page_date, validDay(date) else {
                return unavailable("The receipt's page date is unknown. Its items cannot be resolved by the current source reader.")
            }
            let day = try await reads.day(vehicle, date)
            try current()
            guard day.tied else {
                return unavailable("The source reader has withheld financial detail for the current account.")
            }
            let matches = day.documents.filter { $0.receipt_id == id }
            guard day.date == date, matches.count == 1, let document = matches.first,
                  document.date == date else {
                return unavailable("This receipt is no longer returned by the current source reader. It may have changed, been superseded, or been withheld.")
            }
            // The proposed work context is additive: a failed read leaves the receipt as it was.
            let work = try? await reads.work(vehicle, date)
            try current()
            // Re-check membership after reading: don't publish a result whose link changed in flight.
            let latest = try await reads.links(id)
            try current()
            guard latest == links else {
                return unavailable("The receipt link changed during this read. Refresh to read its current source.")
            }
            return .loaded(.init(document: document, readAt: Date(), work: work?.visible == true ? work : nil))
        } catch {
            return .refused(JobReaders.refusal("receipt evidence", error))
        }
    }

    static func validDay(_ day: String) -> Bool {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.isLenient = false
        guard day.count == 10, let parsed = formatter.date(from: day) else { return false }
        return formatter.string(from: parsed) == day
    }

    private static func unavailable(_ detail: String) -> JobLoad<ReceiptEvidence> {
        .refused(.init(reader: "receipt evidence", kind: .unavailable,
                      title: "Receipt detail unavailable", detail: detail))
    }
}

struct ReceiptEvidenceView: View {
    let receiptId: UUID
    let vehicleId: UUID
    var onInvalidated: () -> Void = {}
    @State private var state: JobLoad<ReceiptEvidence> = .loading
    @State private var generation = UUID()

    var body: some View {
        List {
            switch state {
            case .loading: ProgressView("Reading receipt evidence…")
            case .refused(let refusal):
                JobRefusalRow(refusal: refusal)
                Button("Retry") { Task { await reload() } }
            case .loaded(let evidence): ReceiptEvidenceContent(evidence: evidence)
            }
        }
        .accessibilityIdentifier("receipt-evidence")
        .navigationTitle("Receipt evidence")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await reload() }
        .task(id: "\(receiptId)|\(vehicleId)") {
            var account = SupabaseService.currentUserId
            await reload()
            for await _ in SupabaseService.client.auth.authStateChanges {
                guard !Task.isCancelled else { return }
                let next = SupabaseService.currentUserId
                if next != account { account = next; await reload() }
            }
        }
    }

    private func reload() async {
        let request = UUID(); generation = request; state = .loading
        let result = await ReceiptEvidenceReaders.load(receipt: receiptId, vehicle: vehicleId)
        guard !Task.isCancelled, generation == request else { return }
        state = result
        if case .refused(let refusal) = result, refusal.kind == .unavailable { onInvalidated() }
    }
}

struct ReceiptEvidenceContent: View {
    let evidence: ReceiptEvidence
    private var document: ReceiptEvidenceDocument { evidence.document }

    var body: some View {
        Section("Recorded line items") {
            Text("\(document.lines.count) lines returned by the current source reader. Original completeness is not established.")
                .font(.caption).foregroundStyle(.secondary)
            if document.lines.isEmpty { Text("No current line items returned. Older extraction text is not substituted.") }
            ForEach(Array(document.lines.enumerated()), id: \.offset) { _, line in
                VStack(alignment: .leading, spacing: 6) {
                    Text(line.description ?? "Description not recorded").textSelection(.enabled)
                    if let part = line.part_number { RootedValueView(label: "Part number", value: part, status: .attributed) }
                    reading("Quantity", line.quantity)
                    reading("Unit price", line.unit_price)
                    reading("Line amount", line.amount)
                    if let hours = line.hours { reading("Recorded hours", hours) }
                    if let performer = line.performer { RootedValueView(label: "Performer reading", value: performer, status: .attributed) }
                    if let date = line.line_date { RootedValueView(label: "Recorded line date", value: date, status: .attributed) }
                    if let work = evidence.workLine(line.line_number) {
                        ReceiptWorkContextDisclosure(line: work)
                    } else if let gone = evidence.withdrawnWork(line.line_number) {
                        Text("Proposed work context withdrawn: \(ReceiptWorkWords.withdrawal(gone.reason)).")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }.padding(.vertical, 4)
            }
            RootedValueView(label: "Currency", value: document.currencyText, status: .recorded)
        }
        Section("Source and qualification") {
            if let kind = document.document_kind { RootedValueView(label: "Document kind", value: JobWords.humanize(kind), status: .recorded) }
            if let date = document.date { RootedValueView(label: "Page date", value: date, status: .attributed) }
            if let basis = document.date_source { RootedValueView(label: "Date source", value: JobWords.humanize(basis), status: .recorded) }
            if let basis = document.link_basis { RootedValueView(label: "Vehicle link basis", value: JobWords.humanize(basis), status: .recorded) }
            if let basis = document.date_basis, basis != .null {
                DisclosureGroup("Recorded date evidence") { Text(basis.text).font(.caption).textSelection(.enabled) }
            }
            Text("These are recorded document readings. They do not establish payment, allocation, installation, or who performed work. Investment totals are not reconciled here. Original pages are not opened here.")
                .font(.caption).foregroundStyle(.secondary)
            if evidence.work == nil {
                Text("Proposed work context unavailable in this read.").font(.caption).foregroundStyle(.secondary)
            }
        }
        Section {
            Text("Read \(evidence.readAt.formatted(date: .abbreviated, time: .shortened)). Refresh to check for changes.")
                .font(.caption).foregroundStyle(.secondary)
            DisclosureGroup("Record references") {
                RootedValueView(label: "Receipt", value: document.receipt_id.uuidString.lowercased(), status: .recorded)
                if let source = document.document_id { RootedValueView(label: "Source", value: source.uuidString.lowercased(), status: .recorded) }
            }
        }
    }

    private func reading(_ label: String, _ value: JobJSON?) -> some View {
        RootedValueView(label: label, value: scalar(value) ?? "Not recorded or unreadable",
                        status: scalar(value) == nil ? .recorded : .attributed)
    }
    private func scalar(_ value: JobJSON?) -> String? {
        switch value {
        case .string(let text): return text.isEmpty ? nil : text
        case .number(let value) where value.isFinite: return JobJSON.number(value).text
        default: return nil
        }
    }
}

/// One line's proposed receipt-to-work context, behind a disclosure, in the same rooted-row style as the line.
struct ReceiptWorkContextDisclosure: View {
    let line: ReceiptWorkContextLine

    var body: some View {
        DisclosureGroup("Proposed work context") {
            RootedValueView(label: "Proposed", value: ReceiptWorkWords.conclusion(line.conclusion)
                            + (line.confidence.map { String(format: " · %.2f", $0) } ?? ""), status: .projected)
            Text(ReceiptWorkWords.notAsserted).font(.caption).foregroundStyle(.secondary)
            if let anchor = line.anchor_date { RootedValueView(label: "Compared from", value: anchor, status: .attributed) }
            RootedValueView(label: "Cited frames", value: "\(line.frames.count) you may see"
                            + (line.frames_hidden > 0 ? " · \(line.frames_hidden) withheld (private or not yet cleared)" : ""), status: .recorded)
            ForEach(line.frames, id: \.image_id) { frame in
                RootedValueView(label: "Frame", value: [frame.taken_at.map { "taken \($0.prefix(10))" },
                    frame.photographer?.attribution.map { "photographer (photo record): \($0)" }].compactMap { $0 }.joined(separator: " · "),
                    status: .attributed)
            }
            if let printed = line.printed {
                if let date = printed.line_date { RootedValueView(label: "Printed date (document says)", value: date, status: .attributed) }
                if let hours = printed.hours, hours != .null { RootedValueView(label: "Printed hours (document says)", value: hours.text, status: .attributed) }
            }
            if let performer = line.printed_performer?.value {
                RootedValueView(label: "Performer as printed (document says)", value: performer, status: .attributed)
            }
            if let custodian = line.custodian {
                RootedValueView(label: "Custodian", value: "The account the document is filed under" + (custodian.masked == true ? " (withheld)" : "")
                                + "; custody only, not ownership or payment", status: .recorded)
            }
            RootedValueView(label: "Source", value: [line.lineage.source_document_table.map(JobWords.humanize),
                line.lineage.line_number.map { "line \($0)" },
                line.lineage.link_basis.map { "linked by \(JobWords.humanize($0))" }].compactMap { $0 }.joined(separator: " · "), status: .recorded)
            RootedValueView(label: "Page", value: "Not resolved: " + (line.lineage.page_reason ?? "line-to-page mapping unresolved"), status: .recorded)
            if let judgment = line.judgment {
                RootedValueView(label: "Question", value: ReceiptWorkWords.judgment(judgment), status: judgment.status == "answered" ? .projected : .pending)
                if let quote = judgment.answer?.quote { Text("“\(quote)”").font(.caption).textSelection(.enabled) }
            }
        }
        .font(.callout)
        .accessibilityIdentifier("receipt-work-context")
    }
}
