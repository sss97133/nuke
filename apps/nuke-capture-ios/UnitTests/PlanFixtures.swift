// PlanFixtures.swift — listing_work_plan_read and work_order_inspection_read JSON for tests.
// Test-only; never in the app bundle. Keys mirror pg_get_functiondef and live anon output on
// 2026-10-19; values synthetic. Nothing here is ever sent to request_inspection in production.

enum PlanFixtures {
    static let vehicleId = "00000000-0000-4000-8000-0000000000a7"

    static let plan = """
    {"schema_version":"buying_plan_v1","state":"public_current_parent","vehicle_id":"\(vehicleId)",
     "viewer":{"context":"visitor","slots":[]},"as_of":"2026-10-19T11:30:00Z",
     "record_label":"1997 Fixture LX450","listing_url":"https://www.example-auctions.test/listing/1997-fixture-lx450",
     "vehicle_label":{"year":1997,"make":"Fixture","model":"LX450","trim":null,"text":"1997 Fixture LX450"},
     "identity":{"fields":{
        "year":{"status":"agree","values":[{"raw":1997,"value":1997,"source":"record"},{"raw":"1997","value":"1997","source":"vin_decode"}]},
        "engine_displacement_l":{"status":"conflict","values":[{"raw":4.5,"value":4.5,"source":"record"},{"raw":"4.7L","value":4.7,"source":"listing_text","excerpt":{"start":1,"end":5,"quote":"4.7L"}}]},
        "model":{"status":"unresolved_specificity","values":[{"raw":"LX450","value":"lx450","source":"record"},{"raw":"LX","value":"lx","source":"vin_decode"}]},
        "transmission":{"status":"conflict","values":[{"raw":"Automatic","value":"automatic","source":"record"},{"raw":"5-speed manual","value":"manual","source":"listing_text"},{"raw":"5-speed manual","value":"manual","source":"listing_text"}]},
        "drivetrain":{"status":"agree","values":[{"raw":"4WD","value":"4wd","source":"record"}]}
      },"conflicts":["transmission"],"unresolved_specificity":["model"],
      "vin_decode":{"state":"usable","provider":"nhtsa"},"interpretation":"A conflict means the records disagree."},
     "claims":[
      {"claim_id":"c1","kind":"defect_or_condition","text":"Rust on the rear quarter","facets":[],
       "verbatim_excerpt":{"start":10,"end":40,"quote":"\\nSurface rust is visible on the rear quarter.","offset_unit":"unicode_code_points"},
       "excerpt_status":"exact_excerpt_in_listing_text",
       "source":{"source_url":"https://www.example-auctions.test/listing/1997-fixture-lx450","method":"lexical_candidate"},
       "clocks":{"event_at":null,"recorded_at":null},"confidence":{"basis":"lexical_candidate_unscored","value":null},"review_flags":[]},
      {"claim_id":"c2","kind":"reported_completed_work","text":"Timing belt replaced in 2022","facets":[],
       "verbatim_excerpt":null,"excerpt_status":"extraction_paraphrase_no_exact_excerpt",
       "source":{"source_url":"https://www.example-auctions.test/listing/1997-fixture-lx450"},
       "clocks":{"event_at":"2022-05-01T00:00:00Z"},"confidence":{"value":0.8}},
      {"no":"claim_id"}
     ],
     "exclusions":{"description_discovery_failure_rows":1,"image_claims_excluded_sensitive":2,"keyword_matches_excluded_by_rule":0},
     "candidate_operations":[
      {"operation_id":"op:paint_refinish","keyword_entry_id":"paint_refinish","system":"body","claim_ids":["c1"],
       "targets":[{"code":"PAINT-COMPLETE-PANEL","name":"Complete paint per panel","type":"labor_operation",
                   "hours":{"typical":4.0,"min":null,"max":null},"label":"seed_uncalibrated","state":"resolved"},
                  {"code":"RUST-REPAIR","name":"Rust repair","hours":{"typical":null,"min":2,"max":6.5},"label":"seed_uncalibrated"}]}
     ],
     "parts":[
      {"term":"belt","state":"priced_text_fitment_match","rows":[{"catalog_part_id":"p1","part_number":"TB-1","name":"Timing belt kit","price_current":189.5,"currency":"USD","manufacturer":"Fixture"}],
       "fitment":"text_match_unverified"},
      {"term":"gauge","state":"no_priced_text_fitment_match","rows":[]}
     ],
     "ppi_checklist":[{"item_id":"ppi:identity:model","order":0,"basis":"identity_specificity","field":"model","question":"Confirm model from the VIN plate.","finding":{"system":"other"}}],
     "inspection_scope":{"reader":"request_inspection(p_vehicle_id, NULL, inspection_scope)","inspection_type":"pre_purchase",
       "listing_url":"https://www.example-auctions.test/listing/1997-fixture-lx450",
       "ppi_checklist":[
        {"item_id":"ppi:identity:model","basis":"identity_specificity","system":"other","question":"Confirm model from the VIN plate, build documents and the vehicle itself."},
        {"item_id":"ppi:c1","basis":"claim","system":"body","question":"Inspect the rear quarter for rust and its extent."},
        {"item_id":"ppi:c2","basis":"claim","question":"Check records for the timing belt replacement."}]},
     "operation_coverage":{"matched_claims":1,"eligible_claims":2,"claims_without_reference_operation":["c2"]},
     "counts":{"claims":2,"ppi_items":3},
     "rate":{"state":"as_returned","value":{"rate":160.0,"source":"spitball","note":"placeholder"},"interpretation":"Shown exactly as returned."},
     "keyword_table":{"entries":40},"gaps":[],"model_calls":0,"database_writes":0,
     "interpretation":"An estimate to inspect, not an estimate to restore."}
    """

    static let inspection = """
    {"work_order_id":"00000000-0000-4000-8000-0000000000b7","role":"inspection","as_of":"2026-10-19T11:30:00Z",
     "inspections":[
      {"work_order_id":"00000000-0000-4000-8000-0000000000b7","parent_work_order_id":null,"status":"pending",
       "inspection_type":"pre_purchase","requested_at":"2026-10-19T10:00:00Z","requested_by":{"kind":"user","handle":"fixture_buyer"},
       "listing_url":"https://www.example-auctions.test/listing/1997-fixture-lx450",
       "checklist":[
        {"item_id":"ppi:identity:model","question":"Confirm model from the VIN plate.","system":"other"},
        {"item_id":"ppi:c1","question":"Inspect the rear quarter for rust and its extent.","system":"body"},
        {"item_id":"ppi:c2","question":null,"question_visibility":"withheld_personal_info"}],
       "reports":[],
       "current_report":{"observation_id":"r1","recorded_at":"2026-10-19T11:00:00Z","inspected_at":"2026-10-19T09:00:00Z",
         "recorded_by":{"kind":"user","handle":"fixture_inspector"},"recorded_by_role":"inspector","attribution":"authenticated_sign",
         "inspection":{"schema":"inspection.v1","summary":"Solid truck; rust is surface only.",
           "findings":[
            {"item_id":"ppi:identity:model","system":"other","finding":"VIN plate reads LX450 series.","severity":"info","verdict":"supports"},
            {"item_id":"ppi:c1","system":"body","finding":"Surface rust on the rear quarter, no perforation.","severity":"monitor","verdict":"supports","evidence_photo_ref":"img:abc"},
            {"system":"brakes","finding":"Front pads near the wear limit.","severity":"concern"}]},
         "checklist_coverage":{"items":3,"with_findings":2}},
       "state":"findings_recorded",
       "seller_permission":{"state":"established","granted_at":"2026-10-18T12:00:00Z","scope":"Inspect at the seller's shop",
         "window":{"from":"2026-10-20T00:00:00Z","until":"2026-10-22T00:00:00Z"},"granted_by":{"kind":"user","label":"unnamed party"}},
       "quote":{"current_version":null,"acceptance_state":"not_accepted"},"payment_authorized":false}
     ],
     "viewer":{"context":"client","slots":["customer"],"party":true,"actions":[]},
     "coverage":{"inspections":1,"with_findings":1}}
    """

    static let inspectionRequested = """
    {"work_order_id":"w2","role":"inspection","inspections":[{"work_order_id":"w2","inspection_type":"pre_purchase",
      "checklist":[{"item_id":"inspection:general","question":"General pre purchase inspection of the vehicle"}],"reports":[],"current_report":null,
      "state":"requested","seller_permission":{"state":"not_established","basis":"no current authenticated permission"}}],
     "viewer":{"context":"provider","slots":["inspector"],"actions":[{"action":"record_findings","rpc":"record_inspection_findings","args":{"p_inspection_work_order_id":"w2"}}]}}
    """

    static let orderReceipt = """
    {"work_order_id":"00000000-0000-4000-8000-0000000000b8","request_observation_id":"x","title":"Pre-purchase inspection",
     "inspection_type":"pre_purchase","request_source":"ios","checklist_items":3,"duplicate":false,
     "vehicle_access_granted":false,"seller_permission":"not_established","payment_authorized":false}
    """
}
