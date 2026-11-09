// Existing investment audit ID → current permitted link → canonical day-document reader.
// No date inference, extraction fallback, source download, or financial rollup.
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
            // Re-check membership after reading: don't publish a result whose link changed in flight.
            let latest = try await reads.links(id)
            try current()
            guard latest == links else {
                return unavailable("The receipt link changed during this read. Refresh to read its current source.")
            }
            return .loaded(.init(document: document, readAt: Date()))
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
