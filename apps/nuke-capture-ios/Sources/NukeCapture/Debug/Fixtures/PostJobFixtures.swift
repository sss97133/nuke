// PostJobFixtures.swift — posting a job and starting work, for tests. DEBUG-only (unit tests and the UI-test fixture backend); never compiled into Release.
// Keys mirror pg_get_functiondef (post_work_request, start_work, work_order_start_terms,
// work_order_execution_start_overlay, work_order_job_actions) on 2026-10-19; values synthetic.
// No writer is ever called with these.

#if DEBUG
enum PostJobFixtures {
    static let vehicleId = JobFixtures.vehicleId
    static let workOrderId = "00000000-0000-4000-8000-0000000000c1"
    static let termsHash = String(repeating: "7b", count: 32)

    static let posted = """
    {"work_order_id":"\(workOrderId)","request_observation_id":"o1","requested_at":"2026-10-19T13:40:00Z","request_source":"ios",
     "request_source_basis":"x-client-info header names the Swift SDK -> ios; otherwise web","visibility":"open",
     "listed_in_open_requirements":true,"listing_basis":"open_public_vehicle","needed_by":"2026-11-15T00:00:00Z",
     "operations":[{"line_item_id":"li1","line_number":1,"text":"Replace the front brake pads and rotors.","task_type":"other","basis":"client_stated","keyword_entry_ids":["brakes_pads"]},
                   {"line_item_id":"li2","line_number":2,"text":"Bleed the brake lines.","task_type":"other","basis":"client_stated","keyword_entry_ids":["brakes_bleed"]},
                   {"line_item_id":"li3","line_number":3,"text":"Look at the squeak from the rear.","task_type":"other","basis":"client_stated","keyword_entry_ids":[]}],
     "requirements":[{"requirement_id":"r1","line_item_id":"li1","kind":"skill","description":"Brake service","basis":"reviewed_template"},
                     {"requirement_id":"r2","line_item_id":"li1","kind":"facility","description":"A lift","basis":"reviewed_template"},
                     {"requirement_id":"r3","line_item_id":"li3","kind":"skill","description":"Look at the squeak from the rear.","basis":"client_description"}],
     "intake_evidence":{"attachment_id":"att1","image_count":2},"image_analyses_cited":[],
     "suggested_cost":{"lines":[
        {"line_number":1,"text":"Replace the front brake pads and rotors.","keyword_entry_ids":["brakes_pads"],"reference_targets":[],"hours":{"low":1.5,"high":3},"cost":{"low":240,"high":480},"state":"estimated"},
        {"line_number":2,"text":"Bleed the brake lines.","keyword_entry_ids":["brakes_bleed"],"reference_targets":[],"hours":null,"cost":null,"state":"reference_rows_absent"},
        {"line_number":3,"text":"Look at the squeak from the rear.","keyword_entry_ids":[],"reference_targets":[],"hours":null,"cost":null,"state":"no_reference_match"}],
      "total":{"low":240,"high":480,"lines_estimated":1,"lines":3},
      "rate":{"rate":160,"source":"spitball","is_estimated":true,"rate_confidence":"spitball_no_data"},"rate_label":"placeholder",
      "currency":null,"currency_basis":"resolve_labor_rate returns no currency","hours_label":"seed_uncalibrated",
      "basis":"reference hours times resolve_labor_rate() as returned; not a quote"},
     "duplicate":false,"payment_authorized":false,"providers_notified":false}
    """

    static let duplicate = """
    {"work_order_id":"\(workOrderId)","request_observation_id":"o1","duplicate":true,"payment_authorized":false,"providers_notified":false}
    """

    static let photos = """
    [{"id":"i1","image_url":null,"taken_at":"2026-10-10T10:00:00Z","created_at":"2026-10-10T11:00:00Z","is_sensitive":false,"is_superseded":false,"vision_gate_status":"passed"},
     {"id":"i2","image_url":null,"taken_at":null,"created_at":"2026-10-09T11:00:00Z","is_sensitive":null,"is_superseded":null,"vision_gate_status":null},
     {"id":"i3","image_url":null,"created_at":"2026-10-08T11:00:00Z","is_sensitive":true,"is_superseded":false,"vision_gate_status":null},
     {"id":"i4","image_url":null,"created_at":"2026-10-07T11:00:00Z","is_sensitive":false,"is_superseded":false,"vision_gate_status":"rejected_personal"},
     {"id":"i5","image_url":null,"created_at":"2026-10-06T11:00:00Z","is_sensitive":false,"is_superseded":true,"vision_gate_status":null}]
    """

    private static let providerViewer = #""context":"provider","slots":["accepted_provider"]"#

    /// The accepted technician before starting: start_work offered with the offer's terms hash.
    static let beforeStart: String = JobFixtures.jobPathWithLabels
        .replacingOccurrences(of: #""context":"client","slots":["customer"]"#, with: providerViewer)
        .replacingOccurrences(of: #""actions":[],"#, with: """
        "actions":[{"action":"start_work","rpc":"start_work","args":{"p_work_order_id":"\(JobFixtures.workOrderId)","p_terms_hash":"\(termsHash)"},
                    "terms_basis":"accepted_offer","binds":["your statement that you started this work under these exact terms (by hash)"],
                    "does_not_bind":["completion","schedule","payment"]}],
        """)
        .replacingOccurrences(of: #""execution":{"state":"recorded","start_clock":"2026-10-05T15:00:00+00:00","#,
                              with: #""execution":{"state":"absent","start_sign":null,"state_basis":"no_start_sign","start_clock":null,"#)

    /// After start_work: execution recorded from the start Sign, no action left.
    static let afterStart: String = JobFixtures.jobPathWithLabels
        .replacingOccurrences(of: #""context":"client","slots":["customer"]"#, with: providerViewer)
        .replacingOccurrences(of: #""execution":{"state":"recorded","start_clock":"2026-10-05T15:00:00+00:00","#,
                              with: #""execution":{"state":"recorded","state_basis":"provider_start_sign","start_sign":{"start_id":"s1","started_at":"2026-10-21T16:00:00+00:00","signer_role":"technician","terms_basis":"accepted_offer","terms_current":true,"start_signs":1,"basis":"start_work Sign by a current accepted provider"},"start_clock":null,"#)
}
#endif
