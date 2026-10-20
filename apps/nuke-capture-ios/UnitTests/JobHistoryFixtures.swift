// JobHistoryFixtures.swift — reader JSON for job history: testimony, the operations checklist, evidence.
// Test-only; never in the app bundle. The job-path, operations and empty-evidence shapes are trimmed
// from live anon responses captured read-only on 2026-10-19 (work_order_job_path_read,
// work_order_operations_read, work_order_evidence_read) with ids replaced by fixture ids. Production
// held no evidence attachment that day, so `evidenceForVisitor` follows the reader's
// pg_get_functiondef with synthetic values.

@testable import NukeCapture

extension JobFixtures {
    static let historyOp1 = "00000000-0000-4000-8000-0000000000c1"
    static let historyOp2 = "00000000-0000-4000-8000-0000000000c2"
    static let historyOp3 = "00000000-0000-4000-8000-0000000000c3"

    /// A historical job reconstructed from retained messages, as a signed-out visitor reads it.
    static let historicalJobPath = """
    {"work_order_id":"\(workOrderId)","vehicle_id":"\(vehicleId)","as_of":"2026-10-19T19:02:10.193151+00:00",
     "vehicle_label":{"make":"GMC","text":"1983 GMC K2500 Sierra Classic","trim":"Sierra Classic","year":1983,"model":"K2500"},
     "display_title":"Pre-Delivery Work Order","display_title_basis":"title","request_source_label":"Requested on the web",
     "state_basis":"presence of existing owner records and clocks; not verified truth",
     "stages":{
      "intake":{"gaps":[],"state":"recorded","created_at":"2026-02-27T17:51:48.608998+00:00","scope_stated":true,"vehicle_bound":true,"request_source":"web","inconsistencies":[]},
      "plan":{"gaps":["operations_without_requirements","parts_without_operation_link"],"parts":15,"state":"partial","executable":"not_assessed",
              "labor_rows":11,"operations":15,"requirements":2,"specifications":0,"inconsistencies":[],
              "parts_by_status":{"not_used":1,"cancelled":1,"installed":13},"operations_pending":0,"labor_rows_with_hours":11,
              "labor_rows_ai_estimated":0,"requirements_with_offers":0,"parts_with_operation_code":6,"conflicting_specifications":0,
              "operations_from_scope_text":0,"operations_with_requirements":2,"requirements_with_candidates":0,"requirements_with_accepted_provider":0},
      "terms":{"gaps":["no_approval_clock","no_schedule_window"],"state":"partial","assignments":9,"quote_clock":null,"change_order":null,
               "current_quote":null,"approval_clock":null,"quote_versions":0,"approval_signer":null,
               "inconsistencies":["assignment_accepted_status_without_clock"],"estimate_recorded":true,"quote_clock_basis":null,"accepted_providers":0,
               "retained_testimony":{"basis":"attributed retained messages; not Signs, not verified","claims":3,"by_side":{"client":3},
                                     "by_stage":{"terms_accepted":3},"operations":2,"latest_message_at":"2026-02-24T00:21:07.518+00:00"},
               "customer_acceptance":"not_established","approval_clock_basis":null,
               "assignments_by_status":{"pending":1,"accepted":2,"completed":1,"in_progress":5},"stored_approval_clock":null,
               "schedule_window_recorded":false,"provider_acceptance_clock":null,"assignments_with_accept_clock":0,"provider_acceptances_withheld":0},
      "execution":{"gaps":["no_operation_record"],"state":"recorded","start_sign":null,"start_clock":"2026-02-27T00:00:00+00:00",
                   "state_basis":"legacy_start_clock_or_component_events","measured_usage":"not_established","inconsistencies":[],"component_events":0,
                   "attached_evidence":{"basis":"party-attached own photos (attach_job_evidence)","images":0,"by_role":{},"attachments":0,
                                        "last_attached_at":null,"operations_with_evidence":0},
                   "retained_testimony":{"basis":"attributed retained messages; not Signs, not verified","claims":1,"by_side":{"provider":1},
                                         "by_stage":{"work_paused":1},"operations":0,"latest_message_at":"2026-03-06T18:21:28.527+00:00"},
                   "assignments_started":0,"operations_complete_status":15},
      "accounting":{"gaps":[],"basis":"payments and balances between specific parties are shown only to those parties","state":"withheld",
                    "visibility":"parties_only","disbursement":"not_performed","cost_allocated":false,"inconsistencies":[],"labor_value_calculated":false},
      "completion":{"gaps":["no_status_history","no_provider_completion_attestation"],"state":"absent","status":"in_progress",
                    "state_basis":"no_completion_sign","inconsistencies":["assignment_completed_status_without_clock"],"completion_clock":null,
                    "retained_testimony":{"basis":"attributed retained messages; not Signs, not verified","claims":3,"by_side":{"provider":3},
                                          "by_stage":{"operation_completed":3},"operations":3,"latest_message_at":"2026-03-25T20:07:23.605+00:00"},
                    "customer_acceptance":"not_established","status_history_rows":0,"acceptances_withheld":0,"provider_attestation":null,
                    "attestations_withheld":0,"customer_acceptance_sign":null},
      "inspection":{"gaps":["inspection_performer_unresolved"],"state":"recorded","findings_clock":null,"inconsistencies":[],"inspection_jobs":0,
                    "findings_reports":0,"seller_permission":null,"inspection_job_role":null,"inspection_requirements":1,
                    "with_performer_candidate":0,"inspection_jobs_with_findings":0}},
     "viewer":{"slots":[],"actions":[],"context":"visitor","decided_from":"auth.uid()","money_visible":false,"contact_visible":false,"identity_bridge":"none"},
     "coverage":{"population":"one work order","stages_reported":7},
     "booking_readiness":"not_assessed","payment_authorized":false,"permission_authority":"not_assessed"}
    """

    /// The same reader on a job whose testimony blocks are empty (claims 0).
    static let silentTestimony = """
    {"basis":"attributed retained messages; not Signs, not verified","claims":0,"by_side":{},"by_stage":{},"operations":0,"latest_message_at":null}
    """

    /// work_order_operations_read for a visitor: operations read from the work order's own text, none done.
    static let operationsFromScopeText = """
    {"work_order_id":"\(workOrderId)","as_of":"2026-10-19T19:02:12.000000+00:00","work_order_status":"pending",
     "operations":[
      {"id":"\(historyOp1)","status":"pending","quote_ref":{"ref_id":"\(historyOp1)","ref_kind":"operation"},"task_type":"replace",
       "description":"TH350/400 transmission pan gasket replacement","line_number":1,"requirements":[],"specifications":[],
       "description_basis":"description","requested_by_role":"scope_text_interpretation","requested_by_basis":"source_without_sign"},
      {"id":"\(historyOp2)","status":"pending","quote_ref":{"ref_id":"\(historyOp2)","ref_kind":"operation"},"task_type":"replace",
       "description":"Oil pan gasket replacement","line_number":2,"requirements":[],"specifications":[],
       "description_basis":"description","requested_by_role":"scope_text_interpretation","requested_by_basis":"source_without_sign"},
      {"id":"\(historyOp3)","status":"pending","quote_ref":{"ref_id":"\(historyOp3)","ref_kind":"operation"},"task_type":"inspect",
       "description":"U-joint inspection","line_number":6,"requirements":[],"specifications":[],
       "description_basis":"description","requested_by_role":"scope_text_interpretation","requested_by_basis":"source_without_sign"}],
     "scope_specifications":[],"parts":[],"labor":[],
     "coverage":{"labor":0,"parts":0,"prices":"open; recorded line prices, not payments","operations":3,
                 "party_money":"not_returned_by_this_reader","customer_contact":"never_returned"},
     "viewer":{"party":false,"slots":[],"actions":[],"context":"visitor","decided_from":"auth.uid()","money_visible":false,
               "contact_visible":false,"identity_bridge":"none","quote_issuer_role":null},
     "people_basis":"no people are returned; requested_by is a role","payment_authorized":false}
    """

    /// work_order_operations_read on a shop-entered historical job: rows marked complete with no stated source.
    static let operationsUnsourcedComplete = """
    {"work_order_id":"\(workOrderId)","as_of":"2026-10-19T19:02:11.000000+00:00","work_order_status":"in_progress",
     "operations":[
      {"id":"\(historyOp1)","status":"complete","quote_ref":{"ref_id":"\(historyOp1)","ref_kind":"operation"},"task_type":"repair",
       "description":"Proportioning valve reset and brake system bleed","line_number":3,"requirements":[],"specifications":[],
       "description_basis":"unsourced_row","requested_by_role":"unknown","requested_by_basis":"not_established"},
      {"id":"\(historyOp2)","status":"complete","quote_ref":{"ref_id":"\(historyOp2)","ref_kind":"operation"},"task_type":"repair",
       "description":"Speedometer repair and install","line_number":5,"requirements":[],"specifications":[],
       "description_basis":"unsourced_row","requested_by_role":"unknown","requested_by_basis":"not_established"}],
     "scope_specifications":[],
     "parts":[{"id":"00000000-0000-4000-8000-0000000000d1","brand":null,"status":"installed","category":null,"quantity":1,"is_comped":true,
               "part_name":"Carburetor cleaner spray","quote_ref":{"ref_id":"00000000-0000-4000-8000-0000000000d1","ref_kind":"part"},
               "unit_price":3.79,"job_op_code":null,"part_number":null,"total_price":3.79}],
     "labor":[{"id":"00000000-0000-4000-8000-0000000000e1","hours":3.0,"status":"complete","is_comped":true,
               "quote_ref":{"ref_id":"00000000-0000-4000-8000-0000000000e1","ref_kind":"labor"},
               "task_name":"Rear brake rebuild — wheel cylinders, shoes, hardware, bleed","total_cost":0.0,"hourly_rate":130.0,
               "job_op_code":null,"task_category":"brakes"}],
     "coverage":{"labor":1,"parts":1,"operations":2},
     "viewer":{"party":false,"slots":[],"actions":[],"context":"visitor","money_visible":false,"contact_visible":false,"quote_issuer_role":null}}
    """

    /// One operation a customer signed through Nuke (post_work_request), with two specifications.
    static let operationSigned = """
    {"id":"\(historyOp1)","status":"in_progress","task_type":"replace","description":"Replace front pads and rotors","line_number":1,
     "requirements":[{"id":"r1","requirement_kind":"skill","quote_ref":{"ref_kind":"requirement","ref_id":"r1"}}],
     "specifications":[{"id":"s1"},{"id":"s2"}],"description_basis":"description",
     "requested_by_role":"customer","requested_by_basis":"authenticated_sign"}
    """

    /// work_order_evidence_read for a visitor on a job with no filings (live, 2026-10-19).
    static let evidenceEmpty = """
    {"as_of":"2026-10-19T19:02:15.216137+00:00",
     "viewer":{"party":false,"slots":[],"actions":[],"context":"visitor","decided_from":"auth.uid()","money_visible":false,
               "contact_visible":false,"identity_bridge":"none"},
     "coverage":{"attachments":0,"image_visibility":"existing vehicle_images read rules for this viewer; withheld images are counted, never described"},
     "attachments":[],
     "people_basis":"people appear by public profile handle, otherwise as unnamed party; raw ids and notes to parties only",
     "display_title":"Pre-Delivery Work Order","work_order_id":"\(workOrderId)"}
    """

    /// work_order_evidence_read for a visitor: two filings, one naming an operation, one photo withheld (synthetic values).
    static let evidenceForVisitor = """
    {"as_of":"2026-10-19T19:30:00+00:00","work_order_id":"\(workOrderId)",
     "viewer":{"party":false,"slots":[],"actions":[],"context":"visitor"},
     "attachments":[
      {"attachment_id":"00000000-0000-4000-8000-0000000000f1","attached_at":"2026-10-18T16:00:00+00:00",
       "attached_by":{"kind":"user","profile_id":"00000000-0000-4000-8000-0000000000b1","handle":"fixture_shop","role":"accepted_provider"},
       "operation":{"operation_id":"\(historyOp2)","line_number":2,"task_description":"Text the reader returned"},
       "note":null,
       "images":[{"image_id":"00000000-0000-4000-8000-000000000101","image_url":"https://example.supabase.co/storage/v1/object/public/vehicle-photos/a.jpg","captured_at":"2026-10-18T15:40:00+00:00"},
                 {"image_id":"00000000-0000-4000-8000-000000000102","image_url":"https://example.supabase.co/storage/v1/object/public/vehicle-photos/b.jpg","captured_at":"2026-10-18T15:41:00+00:00"}],
       "images_withheld":1,"attribution":"authenticated_sign"},
      {"attachment_id":"00000000-0000-4000-8000-0000000000f2","attached_at":"2026-10-17T12:00:00+00:00",
       "attached_by":{"kind":"user","label":"unnamed party","role":"customer"},
       "operation":{"operation_id":"00000000-0000-4000-8000-0000000000c9","line_number":9,"task_description":"Text the reader returned"},
       "images":[],"images_withheld":0,"attribution":"authenticated_sign"}],
     "coverage":{"attachments":2}}
    """
}
