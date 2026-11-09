#if DEBUG
// Synthetic financial records; fixture.nuke.invalid only. No original file request.
enum ReceiptDepthFixtures {
    static let receiptId = "00000000-0000-4000-8000-00000000a001"
    static let links = """
    [{"id":"00000000-0000-4000-8000-00000000b001","receipt_id":"\(receiptId)",
      "vehicle_id":"\(FixtureBackend.navigationVehicleId)","status":"linked","retired_at":null,"page_date":"2026-03-09"}]
    """
    static let proof = """
    {"is_owner_view":true,"proven":{"parts":{"value":35,"count":1},"confirmed_labor":{},"money_in":{},"money_out":{}},
     "projected":{"labor":{}},"market":{},"totals":{"invested_proven":35},
     "audit":{"receipts":[{"id":"\(receiptId)","source":"receipt","vendor":"Fixture Parts Shop","amount":35,"date":"2026-03-09"}]}}
    """
    static let withdrawn = #"{"date":"2026-03-09","tied":true,"documents":[]}"#
    static let day = """
    {"date":"2026-03-09","tied":true,"documents":[{"receipt_id":"\(receiptId)",
      "document_id":"00000000-0000-4000-8000-00000000d001","date":"2026-03-09","date_source":"transaction_date",
      "date_basis":"Printed transaction date; vehicle link cited separately","document_kind":"parts_service",
      "link_basis":"cited_document","currency":null,"lines":[
       {"line_number":1,"description":"Corrected gasket reading","part_number":"TEST-G1","quantity":1,"unit_price":35,"amount":35},
       {"line_number":2,"description":"Recorded zero charge","quantity":1,"unit_price":0,"amount":0}]}]}
    """
}
#endif
