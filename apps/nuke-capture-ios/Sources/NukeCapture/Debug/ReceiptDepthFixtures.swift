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
    // get_vehicle_receipt_work_context: line 1 proposed with one visible frame and one withheld, an answered question;
    // line 2's context withdrawn. Synthetic ids only.
    static let work = """
    {"vehicle_id":"\(FixtureBackend.navigationVehicleId)","page_date":"2026-03-09","visible":true,"tied":true,
     "relationship":"proposed context","lines":[
      {"evidence_id":"00000000-0000-4000-8000-00000000f101","receipt_id":"\(receiptId)","item_id":"00000000-0000-4000-8000-00000000f201",
       "line_number":1,"description":"Corrected gasket reading","amount":35,"conclusion":"install_window_photographed","confidence":0.57,
       "status":"proposed","kind":"receipt_time_context","not_asserted":["independent_corroboration","installation_proof","payment_proof","owner_sign"],
       "anchor_date":"2026-03-09","anchor_source":"page_date:receipt_date","zone":"engine","days_to_first_photo":3,
       "frames":[{"image_id":"00000000-0000-4000-8000-00000000e001","taken_at":"2026-03-12T15:00:00+00:00","image_url":null,"thumbnail_url":null,
                  "photographer":{"label":"photographer (from the photo record)","attribution":"Fixture photographer","documented_by_user_id":null}}],
       "frames_hidden":1,
       "lineage":{"receipt_id":"\(receiptId)","source_document_table":"vehicle_documents","source_document_id":"00000000-0000-4000-8000-00000000d001",
                  "line_number":1,"item_id":"00000000-0000-4000-8000-00000000f201","link_id":"00000000-0000-4000-8000-00000000b001",
                  "link_basis":"cited_document","link_confidence":0.9,"page":null,"page_reason":"line-to-page mapping unresolved"},
       "printed":{"attributed_to":"document","line_date":null,"hours":null,"performer":"FIXTURE TECH"},
       "printed_performer":{"label":"performer as printed on the document (document testimony)","value":"FIXTURE TECH"},
       "custodian":{"label":"account the document is filed under (custody only, not ownership or payment)","user_id":null,"masked":true},
       "judgment":{"question_id":"00000000-0000-4000-8000-00000000f301","status":"answered","question":"receipt_part_visible",
                   "asked_at":"2026-03-13T00:00:00+00:00","holder":null,
                   "answer":{"visible":"yes","installed":"cannot_tell","confidence":0.6,"image_id":null,"quote":"gasket visible"}}}],
     "withdrawn":[{"evidence_id":"00000000-0000-4000-8000-00000000f102","receipt_id":"\(receiptId)","item_id":null,"line_number":2,
                   "status":"withdrawn","reason":"line_removed","prior_evidence_id":null,"prior_conclusion":"receipt_day_photographed"}]}
    """
}
#endif
