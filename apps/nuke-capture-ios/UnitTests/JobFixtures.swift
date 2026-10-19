// JobFixtures.swift — reader-shaped JSON for the job (quote → receipt) tests. Test-only; never in the app bundle.
//
// The job path mirrors read_work_order_job_path (migration 20261019045753) key for key, with
// the viewer block R4 §1 specifies for its authenticated wrapper. Ids are visibly synthetic.

enum JobFixtures {
    static let workOrderId = "00000000-0000-4000-8000-000000000001"
    static let vehicleId = "00000000-0000-4000-8000-0000000000a1"

    static let jobPath = """
    {"work_order_id":"\(workOrderId)","vehicle_id":"\(vehicleId)","as_of":"2026-10-19T05:57:53.123456+00:00",
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
     "state_basis":"presence of existing owner records and clocks; not verified truth",
     "booking_readiness":"not_assessed","permission_authority":"not_assessed","payment_authorized":false,
     "viewer":{"context":"client","slots":["customer"],"money_visible":false,"contact_visible":false,
               "decided_from":"auth.uid()","identity_bridge":"none","actions":[]}}
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
    {"rows":[
      {"work_order_id":"\(workOrderId)","vehicle_id":"\(vehicleId)","title":"Brake service",
       "slots":["customer"],
       "stage_states":{"intake":"recorded","inspection":"absent","plan":"partial","terms":"partial","execution":"recorded","completion":"status_only","accounting":"absent"},
       "first_gap":"no_inspection_requirement","as_of":"2026-10-19T05:57:53Z"},
      {"work_order_id":"00000000-0000-4000-8000-000000000002","vehicle_id":null,"title":null,
       "slots":["performer","inspector"],
       "stage_states":{"intake":"partial","inspection":"recorded","plan":"absent","terms":"absent","execution":"absent","completion":"absent","accounting":"absent","custody":"recorded"},
       "first_gap":"no_vehicle","as_of":"2026-10-19T05:57:53Z"},
      {"vehicle_id":"no work order id"}
     ],
     "coverage":{"returned":2,"total_for_viewer":2},
     "viewer":{"context":"client","slots":["customer","performer","inspector"],"money_visible":false,"decided_from":"auth.uid()"}}
    """

    static let signatureQueue = """
    {"items":[
      {"kind":"accept_terms","ref_id":"00000000-0000-4000-8000-0000000000b1","work_order_id":"\(workOrderId)","clock":"2026-10-18T22:10:00Z","evidence_counts":{"photos":12,"operations":3}},
      {"kind":"work_day","ref_id":"2026-10-17","clock":"2026-10-17T00:00:00Z","evidence_counts":{"photos":41}},
      {"ref_id":"missing kind"}
     ],
     "viewer":{"context":"self","decided_from":"auth.uid()"}}
    """

    static let resources = """
    {"work_order_id":"\(workOrderId)","as_of":"2026-10-19T05:57:53Z",
     "requirements":[{"id":"r1","requirement_kind":"inspection"}],"fulfillments":[],"attestations":[],"specifications":[{"id":"s1"}],
     "coverage":{"recorded_requirements":1,"requirements_with_candidates":0,"recorded_specifications":1,"requirement_population":"not_assessed"},
     "booking_readiness":"not_assessed","payment_authorized":false}
    """
}
