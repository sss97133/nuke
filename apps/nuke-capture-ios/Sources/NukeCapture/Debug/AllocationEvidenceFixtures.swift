#if DEBUG
import Foundation
// Reserved synthetic IDs and exact decimal TEXT. Never admitted to the production ledger.
enum AllocationEvidenceFixtures {
    static let book = "00000000-0000-4000-8000-0000000000d1"
    static let use = "00000000-0000-4000-8000-00000000a201"
    static let document = "00000000-0000-4000-8000-00000000d201"
    static let bank = "00000000-0000-4000-8000-00000000d202"
    static let key = String(repeating: "a", count: 64)
    static let bankKey = String(repeating: "b", count: 64)
    static let row = """
    {"use_id":"\(use)","allocation_index":1,"book_owner_id":"\(book)",
     "document_id":"\(document)","record_source_key":"\(key)","phase":"book_expense",
     "allocated_amount":"9007199254740993.000001","book_amount":"9007199254740993.000001","currency":"USD",
     "record_date":"2026-03-09","description":"Retained allocation record","qualification":"bank_source_revised",
     "basis":"Explicit vehicle-use statement","assigned_method":"owner_statement","assigned_at":"2026-03-12T15:42:00Z",
     "bank_document_id":"\(bank)","bank_source_key":"\(bankKey)","bank_amount":"42.123456","bank_date":"2026-03-10",
     "witnesses":[{"kind":"receipt","id":"00000000-0000-4000-8000-00000000a001","label":"Unfiled receipt citation"},
                   {"kind":"work","label":"Withheld work citation"}]}
    """
    static func source(bank isBank: Bool, currency: String? = "EUR") -> String {
        """
        {"reader":"accounting_record_evidence","document_id":"\(isBank ? bank : document)",
         "source_key":"\(isBank ? bankKey : key)","revised_at":"2026-03-14T10:00:00Z",
         "record":{"kind":"\(isBank ? "retained_bank_movement" : "retained_book_record")","date":"2026-03-10",
                   "amount":"\(isBank ? "42.123456" : "9007199254740993.000001")",
                   "currency":\(isBank ? (currency.map { "\"\($0)\"" } ?? "null") : "\"USD\""),
                   "description":"\(isBank ? "Revised bank reading" : "Current book reading")"}}
        """
    }
}
#endif
