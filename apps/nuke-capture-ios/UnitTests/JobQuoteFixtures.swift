// JobQuoteFixtures.swift — open-reader JSON for quotes, vehicle work lists and statements.
// Test-only; never in the app bundle. Keys mirror the readers as pg_get_functiondef stated them on
// 2026-10-19 (work_order_open_header, work_order_quotes_read, work_order_quote_for_viewer,
// vehicle_work_orders_read, work_order_statement_read, accept_work_order_quote); values are
// synthetic.

extension JobFixtures {
    static let quoteId = "00000000-0000-4000-8000-0000000000f2"
    static let quoteHash = String(repeating: "ab", count: 32)

    /// work_order_job_path_read for a signed-out visitor on a public vehicle.
    static let anonJobPath = """
    {"work_order_id":"\(workOrderId)","vehicle_id":"\(vehicleId)","as_of":"2026-10-19T08:41:00Z",
     "vehicle_label":{"year":1983,"make":"GMC","model":"K2500","trim":"Sierra Classic","text":"1983 GMC K2500 Sierra Classic"},
     "display_title":"Exhaust fabrication","display_title_basis":"title","request_source_label":"Requested on the web",
     "stages":{
      "intake":{"state":"recorded","vehicle_bound":true,"scope_stated":true,"request_source":"web","created_at":"2026-10-02T17:04:11Z","gaps":[],"inconsistencies":[]},
      "inspection":{"state":"absent","inspection_requirements":0,"with_performer_candidate":0,"gaps":["no_inspection_requirement"],"inconsistencies":[]},
      "plan":{"state":"partial","operations":2,"gaps":["operations_without_requirements"],"inconsistencies":[]},
      "terms":{"state":"partial","quote_clock":"2026-10-18T20:00:00Z","quote_clock_basis":"current_quote",
               "current_quote":{"quote_id":"\(quoteId)","version":2,"quote_hash":"\(quoteHash)"},"quote_versions":2,
               "approval_clock":null,"approval_clock_basis":null,"approval_signer":null,"stored_approval_clock":null,
               "estimate_recorded":true,"customer_acceptance":"not_established","assignments":0,"assignments_by_status":{},
               "assignments_with_accept_clock":0,"schedule_window_recorded":false,
               "gaps":["no_approval_clock","acceptance_withheld_scope_changed_since_quote"],"inconsistencies":[]},
      "execution":{"state":"recorded","start_clock":"2026-10-05T15:00:00Z","component_events":4,"gaps":[],"inconsistencies":[]},
      "completion":{"state":"recorded","status":"completed","completion_clock":"2026-10-09T15:00:00Z","gaps":[],"inconsistencies":[]},
      "accounting":{"state":"withheld","visibility":"parties_only",
                    "basis":"payments and balances between specific parties are shown only to those parties",
                    "labor_value_calculated":false,"cost_allocated":false,"disbursement":"not_performed","gaps":[],"inconsistencies":[]}
     },
     "state_basis":"presence of existing owner records and clocks; not verified truth",
     "booking_readiness":"not_assessed","permission_authority":"not_assessed","payment_authorized":false,
     "viewer":{"context":"visitor","slots":[],"money_visible":false,"contact_visible":false,"decided_from":"auth.uid()","identity_bridge":"none",
               "actions":[],"actions_basis":"no Sign writer exists yet; the server lists actionable steps here"},
     "coverage":{"stages_reported":7,"population":"one work order","withheld":["accounting: party payments and balances"]}}
    """

    private static let currentQuote = """
    {"quote_id":"\(quoteId)","version":2,"supersedes_quote_id":"00000000-0000-4000-8000-0000000000f1","quote_hash":"\(quoteHash)",
     "quoting_party":{"kind":"user","profile_id":"00000000-0000-4000-8000-0000000000c9","handle":"fixture_shop",
                      "attribution":"authenticated_sign","issued_by_role":"performer"},
     "valid_until":"2026-11-15T00:00:00Z","expired":false,
     "scope_snapshot":{"operations":[],"requirements":[],"specifications":[],"parts":[],"labor":[]},
     "scope_counts":{"operations":2,"parts":1},
     "lines":[
      {"ref_kind":"operation","ref_id":"o1","description":"Fabricate exhaust","pricing_basis":"flat","amount":1200,"currency":"USD","unit":null,"quantity":null},
      {"ref_kind":"labor","ref_id":"l1","description":"Labor","pricing_basis":"hourly","amount":160,"currency":"USD","unit":"hour","quantity":3},
      {"ref_kind":"operation","ref_id":"o2","description":"Road test","pricing_basis":"day_rate","amount":400,"currency":"USD","unit":"day","quantity":null},
      {"ref_kind":"fee","ref_id":null,"description":null,"description_visibility":"withheld_personal_info","pricing_basis":"per_operation","amount":null,"currency":null,"unit":"operation","quantity":null}
     ],
     "unpriced_lines":1,
     "totals_by_currency":[{"currency":"USD","total":1680,"complete":false}],
     "totals_basis":"flat amounts plus rate times stated quantity; a rate line without a quantity leaves its currency incomplete",
     "deposit_requested":{"amount":300,"currency":"USD","nature":"requested_term_not_payment"},
     "source":{"observation_id":"\(quoteId)","extraction_method":"work_order_quote_issue_sign_v1"},
     "recorded_at":"2026-10-18T20:00:00Z","scope_status":"matches_current"}
    """

    static let quotesForCustomer = """
    {"vehicle_label":{"year":1983,"make":"GMC","model":"K2500","trim":"Sierra Classic","text":"1983 GMC K2500 Sierra Classic"},
     "display_title":"Exhaust fabrication","display_title_basis":"title","request_source_label":"Requested on the web",
     "work_order_id":"\(workOrderId)","as_of":"2026-10-19T08:41:00Z","work_order_status":"pending",
     "quoted_at":{"stored":null,"derived":"2026-10-18T20:00:00Z","basis":"current quote observation clock"},
     "approved_at":{"stored":null,"derived":null,"basis":"current quote acceptance sign clock"},
     "current_quote":\(currentQuote),
     "history":[
      {"quote_id":"00000000-0000-4000-8000-0000000000f1","version":1,"observed_at":"2026-10-12T20:00:00Z","state":"superseded","withheld_reason":"superseded_by_newer_version","acceptances_recorded":0},
      {"quote_id":"\(quoteId)","version":2,"observed_at":"2026-10-18T20:00:00Z","state":"current","withheld_reason":null,"acceptances_recorded":0}
     ],
     "acceptance":{"state":"not_accepted","accepted_by_viewer":false,"quote_id":null,"quote_version":null,"quote_hash":null,
                   "signed_at":null,"signer_role":null,"signer":null,"withheld_reason":null},
     "viewer":{"context":"client","slots":["customer"],"money_visible":true,"contact_visible":false,"decided_from":"auth.uid()",
               "identity_bridge":"none","party":true,"prices_visible":true,
               "actions":[{"action":"accept_quote","rpc":"accept_work_order_quote","args":{"p_quote_id":"\(quoteId)","p_quote_hash":"\(quoteHash)"}}]},
     "coverage":{"quote_versions":2,"versions_with_current_source":2,"acceptances_recorded":0,"prices":"open",
                 "party_money":"not_returned_by_this_reader","customer_contact":"never_returned"},
     "people_basis":"people appear by public profile handle, otherwise as unnamed party; organizations by name; raw ids to parties only",
     "deposit_collected":"not_established","payment_authorized":false,"disbursement":"not_performed"}
    """

    static let quotesAcceptedForVisitor = """
    {"work_order_id":"\(workOrderId)","as_of":"2026-10-19T08:41:00Z",
     "current_quote":{"quote_id":"\(quoteId)","version":1,"quote_hash":"\(quoteHash)",
       "quoting_party":{"kind":"organization","organization_id":"00000000-0000-4000-8000-0000000000aa","name":"Fixture Garage",
                        "attribution":"source_attributed_not_authenticated"},
       "valid_until":null,"expired":false,
       "lines":[{"ref_kind":"operation","description":"Brake service","pricing_basis":"flat","amount":"450.5","currency":"USD","unit":null,"quantity":null}],
       "unpriced_lines":0,"totals_by_currency":[{"currency":"USD","total":450.5,"complete":true}],"deposit_requested":null,
       "scope_status":"matches_current"},
     "history":[{"quote_id":"\(quoteId)","version":1,"state":"current"},{"quote_id":"q0","version":0,"state":"withdrawn","quote_hash":"x"}],
     "acceptance":{"state":"accepted","accepted_by_viewer":false,"quote_version":1,"signed_at":"2026-10-18T21:00:00Z",
                   "signer_role":"customer","signer":{"kind":"user","label":"unnamed party"},"withheld_reason":null},
     "viewer":{"context":"visitor","slots":[],"money_visible":false,"party":false,"prices_visible":true,"actions":[]},
     "deposit_collected":"not_established","payment_authorized":false}
    """

    static let quotesNone = """
    {"work_order_id":"\(workOrderId)","current_quote":null,"history":[],"acceptance":{"state":"not_accepted"},
     "viewer":{"context":"visitor","slots":[],"actions":[]}}
    """

    static let acceptReceipt = """
    {"acceptance_id":"00000000-0000-4000-8000-0000000000ac","quote_id":"\(quoteId)","quote_version":2,"quote_hash":"\(quoteHash)",
     "work_order_id":"\(workOrderId)","signed_at":"2026-10-19T09:00:00Z","signer_role":"customer","duplicate":false,
     "work_order_status_changed":false,"deposit_collected":false,"payment_authorized":false}
    """

    static let vehicleWorkOrders = """
    {"viewer":{"slots":[],"context":"visitor","decided_from":"auth.uid()","money_visible":false,"contact_visible":false,
               "identity_bridge":"none","money_visible_basis":"per row"},
     "as_of":"2026-10-19T08:41:00Z","vehicle_id":"\(vehicleId)",
     "vehicle_label":{"year":1983,"make":"GMC","model":"K2500","trim":"Sierra Classic","text":"1983 GMC K2500 Sierra Classic"},
     "rows":[
      {"work_order_id":"\(workOrderId)","vehicle_id":"\(vehicleId)","title":"Exhaust fabrication","display_title":"Exhaust fabrication",
       "display_title_basis":"title","request_source_label":"Requested on the web","slots":[],"money_visible":false,
       "vehicle_label":{"year":1983,"make":"GMC","model":"K2500","trim":"Sierra Classic","text":"1983 GMC K2500 Sierra Classic"},
       "stage_states":{"intake":"recorded","inspection":"absent","plan":"partial","terms":"partial","execution":"recorded","completion":"recorded","accounting":"withheld"},
       "first_gap":{"stage":"inspection","gap":"no_inspection_requirement"},"inconsistencies":0,"as_of":"2026-10-19T08:41:00Z"},
      {"work_order_id":"00000000-0000-4000-8000-000000000005","vehicle_id":"\(vehicleId)","title":"Work order on 1983 GMC K2500 Sierra Classic",
       "display_title":"Work order on 1983 GMC K2500 Sierra Classic","display_title_basis":"vehicle","slots":[],"money_visible":false,
       "stage_states":{"intake":"partial","inspection":"absent","plan":"absent","terms":"absent","execution":"absent","completion":"absent","accounting":"withheld"},
       "first_gap":{"stage":"intake","gap":"no_scope"},"inconsistencies":1,"as_of":"2026-10-19T08:41:00Z"}
     ],
     "next_after":null,
     "coverage":{"returned":2,"total_for_vehicle":2,"population":"every work order on this vehicle",
                 "state_basis":"presence of existing owner records and clocks; not verified truth"}}
    """

    private static func statementWO(party: Bool) -> String {
        """
        {"vehicle_label":{"text":"1983 GMC K2500 Sierra Classic"},"display_title":"Exhaust fabrication","display_title_basis":"title",
         "request_source_label":"Requested on the web","id":"\(workOrderId)","title":"Exhaust fabrication","status":"completed",
         "created_at":"2026-10-02T17:04:11Z","slots":\(party ? #"["customer"]"# : "[]"),"money_visible":\(party),
         "notes":null,
         "parts":[{"id":"p1","part_name":"Stainless tubing","quantity":2,"unit_price":85.5,"total_price":171,"is_comped":false,"notes":null},
                  {"id":"p2","part_name":"Hanger kit","quantity":1,"unit_price":40,"total_price":null,"is_comped":true,"comp_retail_value":40}],
         "labor":[{"id":"l1","task_name":"Fabrication","hours":6.5,"hourly_rate":160,"total_cost":1040,"is_comped":false}],
         "payments":\(party ? #"[{"id":"m1","amount":500,"payment_method":"card","sender_name":"x","memo":"y","payment_date":"2026-10-09","status":"completed"}]"# : "null"),
         "payments_visibility":"\(party ? "party" : "withheld_not_party")",
         "parts_total":171,"labor_total":1040,"comped_value":40,
         "payments_total":\(party ? "500" : "null"),"balance_due":\(party ? "711" : "null")}
        """
    }

    static let statementVisitor = """
    {"viewer":{"context":"visitor","slots":[],"money_visible":false,"money_visible_basis":"per work order"},
     "as_of":"2026-10-19T08:41:00Z",
     "vehicle":{"id":"\(vehicleId)","year":1983,"make":"GMC","model":"K2500","trim":"Sierra Classic","vin":"FIXTUREVIN0000000","text":"1983 GMC K2500 Sierra Classic"},
     "shop":{"name":"Fixture Garage","website":null,"city":"Fixture City","state":"NV","logo_url":null,"tax_rate":null,
             "payment_methods":null,"payment_methods_visibility":"withheld_not_party"},
     "contact":{"action":"contact_via_nuke","available":false,"basis":"contact between users is brokered by Nuke; contact fields are never exposed"},
     "work_orders":[\(statementWO(party: false))],
     "totals":{"parts":171,"labor":1040,"subtotal":1211,"goodwill":40,"payments":null,"balance":null},
     "coverage":{"work_orders":1,"payments_withheld_on":1,"lookup":"vehicle_id","population":"every work order on this vehicle"}}
    """

    static let statementParty = """
    {"viewer":{"context":"client","slots":["customer"],"money_visible":true},"as_of":"2026-10-19T08:41:00Z",
     "vehicle":{"text":"1983 GMC K2500 Sierra Classic"},"shop":null,
     "contact":{"action":"contact_via_nuke","available":false},
     "work_orders":[\(statementWO(party: true))],
     "totals":{"parts":171,"labor":1040,"subtotal":1211,"goodwill":40,"payments":500,"balance":711}}
    """

    static let statementNoMatch = #"{"error":"no_match","lookup":"vehicle_id"}"#
}
