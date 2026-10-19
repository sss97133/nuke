// JobFixtures.swift — reader-shaped JSON for the job (quote → receipt) tests. Test-only; never in the app bundle.
//
// Each fixture mirrors a shipped reader key for key, as pg_get_functiondef stated it on
// 2026-10-19: work_order_job_path_read (read_work_order_job_path + viewer + coverage),
// my_work_orders, my_signature_queue and my_identity_read, all built on job_reader_viewer.
// `jobPathWithLabels` adds the display fields another lane is adding (vehicle_label,
// display_title, request_source_label). Ids and names are visibly synthetic.

enum JobFixtures {
    static let workOrderId = "00000000-0000-4000-8000-000000000001"
    static let vehicleId = "00000000-0000-4000-8000-0000000000a1"

    private static let stages = """
     "stages":{
      "intake":{"state":"recorded","vehicle_bound":true,"scope_stated":true,"request_source":"ios","created_at":"2026-10-02T17:04:11+00:00","gaps":[],"inconsistencies":[]},
      "inspection":{"state":"absent","inspection_requirements":0,"with_performer_candidate":0,"gaps":["no_inspection_requirement"],"inconsistencies":[]},
      "plan":{"state":"partial","operations":3,"operations_with_requirements":1,"requirements":1,"requirements_with_candidates":0,
              "specifications":0,"conflicting_specifications":0,"parts":2,"parts_with_operation_code":1,"parts_by_status":{"ordered":1,"unstated":1},
              "labor_rows":0,"labor_rows_with_hours":0,"labor_rows_ai_estimated":0,"executable":"not_assessed",
              "gaps":["operations_without_requirements","parts_without_operation_link"],"inconsistencies":[]},
      "terms":{"state":"partial","quote_clock":null,"estimate_recorded":true,"approval_clock":null,"schedule_window_recorded":false,
               "assignments":1,"assignments_by_status":{"accepted":1},"assignments_with_accept_clock":0,"customer_acceptance":"not_established",
               "gaps":["no_approval_clock","no_schedule_window"],"inconsistencies":["assignment_accepted_status_without_clock"]},
      "execution":{"state":"recorded","start_clock":"2026-10-05T15:00:00+00:00","component_events":4,"operations_complete_status":1,
                   "assignments_started":0,"measured_usage":"not_established","gaps":[],"inconsistencies":[]},
      "completion":{"state":"status_only","status":"completed","completion_clock":null,"status_history_rows":0,"customer_acceptance":"not_established",
                    "gaps":["no_status_history"],"inconsistencies":["done_status_without_completion_clock"]},
      "accounting":{"state":"absent","payment_records":0,"payment_records_by_status":{},"vehicle_scoped_payment_events":0,
                    "vehicle_payment_job_attribution":"not_established","payouts_recorded":0,"payout_status":{"unstated":1},
                    "labor_value_calculated":false,"cost_allocated":false,"disbursement":"not_performed",
                    "gaps":["no_payment_record","no_payout_record"],"inconsistencies":[]}
     },
    """

    private static let pathTail = """
     "state_basis":"presence of existing owner records and clocks; not verified truth",
     "booking_readiness":"not_assessed","permission_authority":"not_assessed","payment_authorized":false,
     "viewer":{"context":"client","slots":["customer"],"money_visible":false,"contact_visible":false,
               "decided_from":"auth.uid()","identity_bridge":"none","actions":[],
               "actions_basis":"no Sign writer exists yet; the server lists actionable steps here"},
     "coverage":{"stages_reported":7,"population":"one work order","sources":"work_orders, line items"}
    """

    static let jobPath = """
    {"work_order_id":"\(workOrderId)","vehicle_id":"\(vehicleId)","as_of":"2026-10-19T05:57:53.123456+00:00",
    \(stages)
    \(pathTail)}
    """

    static let jobPathWithLabels = """
    {"work_order_id":"\(workOrderId)","vehicle_id":"\(vehicleId)","as_of":"2026-10-19T05:57:53.123456+00:00",
     "display_title":"Front brake service","request_source_label":"Requested in the Nuke app",
     "vehicle_label":{"year":1977,"make":"Chevrolet","model":"Blazer","trim":"Cheyenne"},
    \(stages)
    \(pathTail)}
    """

    /// A later reader: a stage state and a stage key this build has never seen, a viewer
    /// context it does not know, and actions as both strings and objects.
    static let futureJobPath = """
    {"work_order_id":"\(workOrderId)","vehicle_id":null,"as_of":"2026-10-19T05:57:53Z",
     "stages":{
      "intake":{"state":"partial","vehicle_bound":false,"scope_stated":true,"gaps":["no_vehicle"],"inconsistencies":[]},
      "terms":{"state":"awaiting_signature","gaps":[],"inconsistencies":[]},
      "completion":{"state":"recorded","gaps":"not-an-array","inconsistencies":[]},
      "custody":{"state":"recorded","gaps":[],"inconsistencies":[]}
     },
     "booking_readiness":{"verdict":"not_assessed"},"payment_authorized":false,
     "viewer":{"context":"auditor","slots":["inspector"],"money_visible":"yes",
               "actions":["accept_terms",{"kind":"attest_completion","label":"Attest completion","stage":"completion"},{"label":"no kind"},null]}}
    """

    static let myWorkOrders = """
    {"viewer":{"context":"self","slots":[],"money_visible":false,"contact_visible":false,"decided_from":"auth.uid()","identity_bridge":"claimed"},
     "as_of":"2026-10-19T06:40:00Z",
     "rows":[
      {"work_order_id":"\(workOrderId)","vehicle_id":"\(vehicleId)","title":"Brake service",
       "slots":["customer"],
       "stage_states":{"intake":"recorded","inspection":"absent","plan":"partial","terms":"partial","execution":"recorded","completion":"status_only","accounting":"absent"},
       "first_gap":{"stage":"inspection","gap":"no_inspection_requirement"},"inconsistencies":2,"as_of":"2026-10-19T06:40:00Z"},
      {"work_order_id":"00000000-0000-4000-8000-000000000002","vehicle_id":null,"title":null,
       "slots":["org_owner","vehicle_access"],
       "stage_states":{"intake":"partial","inspection":"recorded","plan":"absent","terms":"absent","execution":"absent","completion":"absent","accounting":"absent","custody":"recorded"},
       "first_gap":{"stage":"intake","gap":"no_vehicle"},"inconsistencies":0,"as_of":"2026-10-19T06:40:00Z"},
      {"vehicle_id":"no work order id"}
     ],
     "next_after":"00000000-0000-4000-8000-000000000002",
     "coverage":{"returned":2,"total_for_viewer":5,"slot_filter":null,
                 "population":"work_orders readable under the work_orders read policy, plus evidenced-bridge performer slots",
                 "state_basis":"presence of existing owner records and clocks; not verified truth"}}
    """

    static let myWorkOrdersPage2 = """
    {"viewer":{"context":"self","slots":[]},"as_of":"2026-10-19T06:41:00Z",
     "rows":[
      {"work_order_id":"00000000-0000-4000-8000-000000000003","vehicle_id":"\(vehicleId)","title":"Paint correction",
       "slots":["performer"],"stage_states":{"intake":"recorded"},"first_gap":null,"inconsistencies":0,"as_of":"2026-10-19T06:41:00Z",
       "display_title":"Paint correction","vehicle_label":{"year":"1969","make":"Ford","model":"Mustang"}}
     ],
     "next_after":null,"coverage":{"returned":1,"total_for_viewer":5,"slot_filter":null}}
    """

    static let signatureQueue = """
    {"viewer":{"context":"self","slots":[],"money_visible":false,"contact_visible":false,"decided_from":"auth.uid()","identity_bridge":"none"},
     "as_of":"2026-10-19T06:40:00Z",
     "items":[
      {"kind":"work_session","ref_id":"00000000-0000-4000-8000-0000000000b1","work_order_id":null,
       "vehicle":{"vehicle_id":"\(vehicleId)","year":1977,"make":"Chevrolet","model":"Blazer"},
       "clock":{"session_date":"2026-10-17","start_time":"2026-10-17T15:02:00+00:00","end_time":"2026-10-17T18:12:00+00:00"},
       "capture_span_minutes":190,
       "evidence_counts":{"session_images":12,"vehicle_photos_that_day":41},
       "sign":{"rpc":"confirm_work_session","binds":"self-confirmation of a photo-derived work day",
               "does_not_bind":["counterparty acceptance","labor value","payment"]}},
      {"kind":"work_session","ref_id":"00000000-0000-4000-8000-0000000000b2","work_order_id":null,
       "vehicle":{"vehicle_id":"\(vehicleId)","year":1977,"make":"Chevrolet","model":"Blazer"},
       "clock":{"session_date":"2026-10-12","start_time":null,"end_time":null},
       "capture_span_minutes":45,"evidence_counts":{"session_images":3,"vehicle_photos_that_day":3},
       "sign":{"rpc":"confirm_work_session","binds":"self-confirmation of a photo-derived work day","does_not_bind":["payment"]}},
      {"ref_id":"missing kind"}
     ],
     "coverage":{"returned":2,"total":7,"limit":250,"kinds":["work_session"],
                 "kinds_not_yet_available":["terms","offer","completion_attestation","co_sign_request"],
                 "population":"own unconfirmed work sessions with capture span on own resolved vehicles"}}
    """

    static let identity = """
    {"viewer":{"context":"self","slots":[],"money_visible":false,"contact_visible":false,"decided_from":"auth.uid()","identity_bridge":"claimed"},
     "as_of":"2026-10-19T06:40:00Z",
     "profile":{"user_id":"00000000-0000-4000-8000-0000000000c1","username":"fixture_tech","full_name":null,"avatar_url":null,"bio":null,
                "city":"Fixture City","state":"NV","is_public":true,"member_since":"2025-01-01",
                "self_claims":{"basis":"stated_by_account","role":"mechanic","user_type":null,"profession":null,"expertise_areas":null}},
     "provider_link":{"state":"claimed","actor_id":"00000000-0000-4000-8000-0000000000d1",
       "claims":[
        {"claim_id":"00000000-0000-4000-8000-0000000000e1","actor_id":"00000000-0000-4000-8000-0000000000d1",
         "actor":{"name":"Fixture Mechanic","actor_type":"mechanic"},"rung":"self_claim","status":"pending",
         "filed_at":"2026-10-18T22:30:00+00:00","reviewed_at":null,"evidence_entries":0},
        {"claim_id":"00000000-0000-4000-8000-0000000000e2","actor_id":"00000000-0000-4000-8000-0000000000d2",
         "actor":{"name":"Fixture Painter","actor_type":"painter"},"rung":"work_evidence","status":"approved",
         "filed_at":"2026-09-01T12:00:00+00:00","reviewed_at":"2026-09-03T12:00:00+00:00","evidence_entries":2}
       ],
       "basis":"account_link_claims actor claims; never matched by name, phone or email"},
     "org_memberships":[],"external_identity_claims":[],"payout_setup":"not_established",
     "coverage":{"profile_found":true,"actor_claims":2,"org_memberships":0,"external_identity_claims":0}}
    """

    static let actorHits = """
    [{"id":"00000000-0000-4000-8000-0000000000d1","name":"Fixture Mechanic","actor_type":"mechanic"},
     {"id":"00000000-0000-4000-8000-0000000000d3","name":"Fixture Mechanic Shop","actor_type":"individual"}]
    """

    static let resources = """
    {"work_order_id":"\(workOrderId)","as_of":"2026-10-19T05:57:53Z",
     "requirements":[{"id":"r1","requirement_kind":"inspection"}],"fulfillments":[],"attestations":[],"specifications":[{"id":"s1"}],
     "coverage":{"recorded_requirements":1,"requirements_with_candidates":0,"recorded_specifications":1,"requirement_population":"not_assessed",
                 "source_scope":"explicitly_projected_work_record_observations"},
     "booking_readiness":"not_assessed","payment_authorized":false,
     "viewer":{"context":"client","slots":["customer"],"money_visible":false,"contact_visible":false,"decided_from":"auth.uid()","identity_bridge":"none","party":true}}
    """
}
