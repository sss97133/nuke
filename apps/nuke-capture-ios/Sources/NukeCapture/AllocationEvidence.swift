// Existing canonical allocation → exact current book/bank source. Read only; no money fold.
import Foundation
import Supabase
import SwiftUI

struct AllocationRecord: Decodable, Equatable, Identifiable {
    struct Key: Hashable { let book: UUID; let use: UUID; let index: Int }
    struct Witness: Decodable, Equatable { let kind: String; let id: UUID?; let label: String? }
    let use_id: UUID
    let allocation_index: Int
    let book_owner_id: UUID
    let document_id: UUID
    let record_source_key: String
    let record_line_id: UUID?
    let phase: String
    let allocated_amount: String?
    let book_amount: String?
    let currency: String?
    let record_date: String?
    let description: String?
    let category: String?
    let account: String?
    let basis: String?
    let qualification: String?
    let bank_document_id: UUID?
    let bank_source_key: String?
    // Deliberately never interpret bank_amount/bank_remainder using the allocation's unit.
    let bank_amount: String?
    let bank_date: String?
    let bank_remainder: String?
    let invoice_document_id: UUID?
    let invoice_reference: String?
    let work_order_id: UUID?
    let receipt_id: UUID?
    let receipt_item_id: UUID?
    let work_session_id: UUID?
    let evidence: JobJSON?
    let witnesses: [Witness]?
    let assigned_by: UUID?
    let assigned_method: String?
    let assigned_at: String?
    var id: Key { .init(book: book_owner_id, use: use_id, index: allocation_index) }
    var phaseText: String {
        switch phase {
        case "book_expense": return "Book expense"
        case "customer_receipt": return "Customer receipt"
        case "customer_refund": return "Customer refund"
        default: return "Unrecognized phase: \(phase)"
        }
    }
    var qualificationText: String {
        qualification == "ready" ? "Source consistency checks passed · not payment proof" :
            JobWords.humanize(qualification ?? "qualification_unknown")
    }
}

enum AllocationSource: String, CaseIterable, Identifiable {
    case book, bank
    var id: String { rawValue }
    var title: String { self == .book ? "Current book source" : "Current bank source" }
    func reference(_ row: AllocationRecord) -> AllocationSourceReference? {
        let document = self == .book ? row.document_id : row.bank_document_id
        let key = self == .book ? row.record_source_key : row.bank_source_key
        guard let document, let key, key.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { return nil }
        return .init(owner: row.book_owner_id, document: document, key: key)
    }
}
struct AllocationSourceReference: Equatable {
    let owner: UUID; let document: UUID; let key: String
}
struct AllocationSourceDocument: Decodable {
    struct Record: Decodable {
        let kind: String?
        let date: String?
        let amount: String?
        let currency: String?
        let description: String?
        let category: String?
        let account: String?
    }
    let reader: String
    let document_id: UUID
    let source_key: String
    let revised_at: String?
    let record: Record
    // Legacy `use`, narrative lifting, artifact totals and derived strengths are not allocation truth.
}
struct AllocationSourceRead {
    let document: AllocationSourceDocument
    let readAt: Date
}

// Pagination state only, never a financial measure or persisted parallel book.
struct AllocationPage {
    private(set) var rows: [AllocationRecord] = []
    private(set) var offset = 0
    private(set) var more = false
    mutating func append(_ page: [AllocationRecord], size: Int) {
        offset += page.count
        for row in page {
            if let i = rows.firstIndex(where: { $0.id == row.id }) { rows[i] = row } else { rows.append(row) }
        }
        more = page.count == size
    }
}

@MainActor
enum AllocationWords {
    static func amount(_ text: String?, currency: String?) -> String {
        guard let text, text.range(of: "^-?[0-9]+(?:\\.[0-9]{1,6})?$", options: .regularExpression) != nil else {
            return "Amount not recorded or unreadable"
        }
        guard let currency, currency.range(of: "^[A-Z]{3}$", options: .regularExpression) != nil else {
            return "Monetary reading withheld · source currency unknown"
        }
        return "\(text) \(currency)"
    }
    static func day(_ day: String?) -> String {
        guard let day, ReceiptEvidenceReaders.validDay(day) else { return "Date not recorded or unreadable" }
        return day // A source DATE is not a UTC instant, acquisition date or work date.
    }
}

@MainActor
enum AllocationReaders {
    static let pageSize = 200
    struct Reads {
        var page: (UUID, Int) async throws -> [AllocationRecord] = { vehicle, offset in
            try await SupabaseService.client.rpc("accounting_vehicle_financials", params: ["p_vehicle_id": vehicle.uuidString])
                .order("book_owner_id").order("use_id").order("allocation_index")
                .range(from: offset, to: offset + pageSize - 1).execute().value
        }
        var exact: (UUID, AllocationRecord.Key) async throws -> [AllocationRecord] = { vehicle, key in
            try await SupabaseService.client.rpc("accounting_vehicle_financials", params: ["p_vehicle_id": vehicle.uuidString])
                .eq("book_owner_id", value: key.book.uuidString).eq("use_id", value: key.use.uuidString)
                .eq("allocation_index", value: key.index).limit(2).execute().value
        }
        var source: (AllocationSourceReference) async throws -> AllocationSourceDocument? = { reference in
            try await SupabaseService.client.rpc("accounting_record_evidence", params: [
                "p_owner_id": reference.owner.uuidString, "p_document_id": reference.document.uuidString,
                "p_source_key": reference.key
            ]).execute().value
        }
    }
    static func checkAccount(_ requested: String?, _ account: () -> String?) throws {
        guard !Task.isCancelled, requested != nil, account() == requested else { throw CancellationError() }
    }
    static func unique(_ rows: [AllocationRecord], key: AllocationRecord.Key) throws -> AllocationRecord {
        guard rows.count == 1, let row = rows.first, row.id == key else {
            throw unavailable("This allocation is missing, withheld, withdrawn, or no longer uniquely current.")
        }
        return row
    }
    static func loadRecord(vehicle: UUID, key: AllocationRecord.Key, reads: Reads = Reads(),
                           account: () -> String? = { SupabaseService.currentUserId }) async -> JobLoad<AllocationRecord> {
        let requested = account()
        do {
            try checkAccount(requested, account)
            let rows = try await reads.exact(vehicle, key)
            try checkAccount(requested, account)
            return .loaded(try unique(rows, key: key))
        } catch { return .refused(refusal(error)) }
    }
    static func loadSource(vehicle: UUID, row: AllocationRecord, kind: AllocationSource, reads: Reads = Reads(),
                           account: () -> String? = { SupabaseService.currentUserId }) async -> JobLoad<AllocationSourceRead> {
        let requested = account()
        do {
            try checkAccount(requested, account)
            let beforeRows = try await reads.exact(vehicle, row.id)
            try checkAccount(requested, account)
            let before = try unique(beforeRows, key: row.id)
            guard before == row, let reference = kind.reference(before) else {
                throw unavailable("The allocation or its exact source reference changed. Refresh the allocation.")
            }
            let source = try await reads.source(reference)
            try checkAccount(requested, account)
            guard let source, source.reader == "accounting_record_evidence",
                  source.document_id == reference.document, source.source_key == reference.key else {
                throw unavailable("The exact current source is missing or withheld. Older or nearby records are not substituted.")
            }
            let afterRows = try await reads.exact(vehicle, row.id)
            try checkAccount(requested, account)
            guard try unique(afterRows, key: row.id) == before else {
                throw unavailable("The allocation changed while reading its source. Refresh to read the current record.")
            }
            return .loaded(.init(document: source, readAt: Date()))
        } catch { return .refused(refusal(error)) }
    }
    static func unavailable(_ detail: String) -> JobRefusal {
        .init(reader: "allocation evidence", kind: .unavailable, title: "Allocation detail unavailable", detail: detail)
    }
    static func refusal(_ error: Error) -> JobRefusal {
        if let refusal = error as? JobRefusal { return refusal }
        if error is CancellationError { return unavailable("The account or read changed. Refresh with the current account.") }
        return JobReaders.refusal("allocation evidence", error)
    }
}

struct VehicleAllocationRecordsView: View {
    let vehicleId: UUID
    @State private var page = AllocationPage()
    @State private var loading = true
    @State private var refusal: JobRefusal?
    @State private var readAt: Date?
    @State private var generation = UUID()
    var body: some View {
        List {
            Section {
                Text("Current explicit allocations returned for this vehicle and the books this account may read. This is not a complete financial picture or a cash balance.")
                    .font(.caption).foregroundStyle(.secondary)
                if let readAt {
                    Text("\(page.rows.count) distinct records loaded · read \(readAt.formatted(date: .abbreviated, time: .shortened))")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            ForEach(page.rows) { row in
                NavigationLink {
                    AllocationRecordView(vehicleId: vehicleId, key: row.id) { Task { await load(reset: true) } }
                } label: {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(row.description ?? "Allocation record")
                        Text("\(row.phaseText) · \(row.currency ?? "Unit unknown")").font(.caption)
                        Text(row.qualificationText).font(.caption).foregroundStyle(.secondary)
                    }
                }.accessibilityIdentifier("allocation-record-\(row.use_id.uuidString.lowercased())-\(row.allocation_index)")
            }
            if loading { ProgressView("Reading allocation records…") }
            if let refusal { JobRefusalRow(refusal: refusal); Button("Retry") { Task { await load(reset: true) } } }
            if !loading && refusal == nil {
                if page.rows.isEmpty { Text("No current allocations returned. This does not establish zero spending.") }
                if page.more { Button("Load more records") { Task { await load(reset: false) } } }
                Text("Pages are separate reads. Refresh after changes; exhausting these pages does not establish lifetime coverage.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Book allocations").navigationBarTitleDisplayMode(.inline)
        .refreshable { await load(reset: true) }
        .task(id: vehicleId) {
            var account = SupabaseService.currentUserId
            await load(reset: true)
            for await _ in SupabaseService.client.auth.authStateChanges {
                guard !Task.isCancelled else { return }
                let next = SupabaseService.currentUserId
                if next != account { account = next; await load(reset: true) }
            }
        }
    }
    private func load(reset: Bool) async {
        if !reset && loading { return }
        let request = UUID(); generation = request
        let account = SupabaseService.currentUserId
        if reset { page = AllocationPage(); readAt = nil }
        loading = true; refusal = nil
        do {
            try AllocationReaders.checkAccount(account, { SupabaseService.currentUserId })
            let next = try await AllocationReaders.Reads().page(vehicleId, page.offset)
            try AllocationReaders.checkAccount(account, { SupabaseService.currentUserId })
            guard generation == request else { return }
            // Offset advances by raw page length; deduplication never changes the pagination cursor.
            page.append(next, size: AllocationReaders.pageSize)
            readAt = Date(); loading = false
        } catch {
            guard generation == request else { return }
            page = AllocationPage(); readAt = nil; loading = false
            refusal = AllocationReaders.refusal(error)
        }
    }
}

struct AllocationRecordView: View {
    let vehicleId: UUID
    let key: AllocationRecord.Key
    var onInvalidated: () -> Void = {}
    @State private var state: JobLoad<AllocationRecord> = .loading
    @State private var readAt: Date?
    @State private var generation = UUID()
    var body: some View {
        List {
            switch state {
            case .loading: ProgressView("Checking current allocation…")
            case .refused(let refusal): JobRefusalRow(refusal: refusal); Button("Retry") { Task { await reload() } }
            case .loaded(let row):
                Section("Allocation statement") {
                    Text(row.phaseText)
                    RootedValueView(label: "Allocated amount", value: AllocationWords.amount(row.allocated_amount, currency: row.currency), status: .attributed,
                                    decay: row.assigned_at.map { "Assignment recorded \($0)" } ?? "Assignment clock not recorded")
                    Text(row.qualificationText).font(.caption)
                    Text("An assignment is a statement of vehicle use. It does not identify the payer, worker or owner.").font(.caption).foregroundStyle(.secondary)
                    if let basis = row.basis { RootedValueView(label: "Assignment basis", value: basis, status: .attributed) }
                    if let method = row.assigned_method { RootedValueView(label: "Assignment method", value: method, status: .recorded) }
                }
                Section("Source records") {
                    ForEach(AllocationSource.allCases) { kind in
                        if kind.reference(row) != nil {
                            NavigationLink(kind.title) {
                                AllocationSourceView(vehicleId: vehicleId, row: row, kind: kind) {
                                    state = .refused(AllocationReaders.unavailable("Source access or currentness changed. Refresh this allocation."))
                                    onInvalidated()
                                }
                            }
                        } else { Text("\(kind.title): exact reference not returned").foregroundStyle(.secondary) }
                    }
                }
                Section("Cited witnesses") {
                    Text("Citations are not additional charges, payment proof, installation proof or a filing action. Source files are not opened here.").font(.caption).foregroundStyle(.secondary)
                    ForEach(Array((row.witnesses ?? []).enumerated()), id: \.offset) { _, witness in
                        VStack(alignment: .leading) {
                            Text(witness.label ?? JobWords.humanize(witness.kind))
                            Text(witness.id != nil ? "\(JobWords.humanize(witness.kind)) citation · reference recorded" : "Reference withheld or no longer current")
                                .font(.caption2).foregroundStyle(.secondary).textSelection(.enabled)
                        }
                    }
                    if row.witnesses?.isEmpty != false { Text("No witness citations returned.") }
                    if let reference = row.invoice_reference { RootedValueView(label: "Invoice reference", value: reference, status: .recorded) }
                }
                Section("Read scope") {
                    if let readAt { Text("Read \(readAt.formatted(date: .abbreviated, time: .shortened))").font(.caption) }
                    Text("Records can change; pull to refresh.").font(.caption).foregroundStyle(.secondary)
                    DisclosureGroup("Record references") {
                        Text("Vehicle \(vehicleId.uuidString)\nBook \(row.book_owner_id.uuidString)\nAllocation \(row.use_id.uuidString) / \(row.allocation_index)")
                            .font(.caption2).textSelection(.enabled)
                        reference("Assigning account", row.assigned_by)
                        reference("Invoice document", row.invoice_document_id)
                        reference("Job", row.work_order_id)
                        reference("Receipt", row.receipt_id)
                        reference("Receipt item", row.receipt_item_id)
                        reference("Work session", row.work_session_id)
                        ForEach(Array((row.witnesses ?? []).enumerated()), id: \.offset) { _, witness in
                            reference("\(JobWords.humanize(witness.kind)) citation", witness.id)
                        }
                        Text("Identifiers only; these references do not open source files.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .navigationTitle("Allocation record").navigationBarTitleDisplayMode(.inline)
        .refreshable { await reload() }
        .task(id: key) {
            var account = SupabaseService.currentUserId
            await reload()
            for await _ in SupabaseService.client.auth.authStateChanges {
                guard !Task.isCancelled else { return }
                let next = SupabaseService.currentUserId
                if next != account { account = next; await reload() }
            }
        }
    }
    @ViewBuilder private func reference(_ label: String, _ id: UUID?) -> some View {
        if let id { RootedValueView(label: "\(label) reference", value: id.uuidString, status: .recorded) }
    }
    private func reload() async {
        let request = UUID(); generation = request; state = .loading; readAt = nil
        let result = await AllocationReaders.loadRecord(vehicle: vehicleId, key: key)
        guard !Task.isCancelled, generation == request else { return }
        state = result; readAt = Date()
        if case .refused = result { onInvalidated() }
    }
}

struct AllocationSourceView: View {
    let vehicleId: UUID
    let row: AllocationRecord
    let kind: AllocationSource
    var onInvalidated: () -> Void = {}
    @State private var state: JobLoad<AllocationSourceRead> = .loading
    @State private var generation = UUID()
    var body: some View {
        List {
            switch state {
            case .loading: ProgressView("Checking exact source…")
            case .refused(let refusal): JobRefusalRow(refusal: refusal); Button("Retry") { Task { await reload() } }
            case .loaded(let source):
                let record = source.document.record
                Section("Current source reading") {
                    if let description = record.description { Text(description) }
                    if kind != .bank || record.kind == "retained_bank_movement" {
                        RootedValueView(label: "Source amount", value: AllocationWords.amount(record.amount, currency: record.currency), status: .recorded)
                    } else { Text("Bank monetary interpretation withheld: current source kind is not a retained bank movement.") }
                    RootedValueView(label: "Source record date", value: AllocationWords.day(record.date), status: .recorded)
                    if let category = record.category { RootedValueView(label: "Source category", value: category, status: .recorded) }
                    if let account = record.account { RootedValueView(label: "Source account", value: account, status: .recorded) }
                    Text("A source reading is not payment or use proof. This date is the record's own date.").font(.caption).foregroundStyle(.secondary)
                }
                Section("Source history") {
                    if let revised = source.document.revised_at { Text("Source revision recorded \(revised)").font(.caption) }
                    Text("Read \(source.readAt.formatted(date: .abbreviated, time: .shortened))").font(.caption)
                    Text("Records can change; pull to refresh.").font(.caption).foregroundStyle(.secondary)
                    DisclosureGroup("Record references") {
                        Text("Document \(source.document.document_id.uuidString)\nSource key \(source.document.source_key)")
                            .font(.caption2).textSelection(.enabled).accessibilityIdentifier("allocation-source-reference")
                        Text("Identifiers only; these references do not open source files.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .navigationTitle(kind.title).navigationBarTitleDisplayMode(.inline)
        .refreshable { await reload() }
        .task(id: row.id) {
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
        let result = await AllocationReaders.loadSource(vehicle: vehicleId, row: row, kind: kind)
        guard !Task.isCancelled, generation == request else { return }
        state = result
        if case .refused = result { onInvalidated() }
    }
}
