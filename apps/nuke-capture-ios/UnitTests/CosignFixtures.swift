// CosignFixtures.swift — co-signed offers, change orders and vouches for tests. Test-only.
// Keys mirror pg_get_functiondef (work_order_offers_read, work_order_offer_cosigns, accept_offer,
// cosign_provider, work_order_quotes_read, work_order_quote_for_viewer, work_order_change_order_apply,
// provider_vouched_for_by) on 2026-10-19; values synthetic. No writer is ever called with these.

enum CosignFixtures {
    static let offerId = "00000000-0000-4000-8000-0000000000e9"
    static let offerHash = String(repeating: "cd", count: 32)
    static let termsHash = String(repeating: "9f", count: 32)
    static let workOrderId = "00000000-0000-4000-8000-000000000001"

    static func offers(customer: Bool) -> String {
        let actions = customer
            ? #"[{"action":"accept_offer","rpc":"accept_offer","args":{"p_offer_id":"\#(offerId)","p_offer_hash":"\#(termsHash)"}}]"#
            : #"[{"action":"cosign_provider","rpc":"cosign_provider","args":{"p_work_order_id":"\#(workOrderId)","p_offer_id":"\#(offerId)"},"as":{"attestor_kind":"organization","attestor_organization_id":"o1"},"acting_for":[{"kind":"organization","organization_id":"o1","name":"Fixture Garage","p_cut":{"organization_id":"o1"}},{"kind":"organization","organization_id":"o2","name":"Second Shop","p_cut":{"organization_id":"o2"}},{"kind":"user","label":"yourself","p_cut":{"as":"self"}}]}]"#
        return """
        {"work_order_id":"\(workOrderId)","display_title":"Pre-delivery work","as_of":"2026-10-19T12:00:00Z",
         "requirements":[{"requirement_id":"r1","requirement_kind":"skill","description":"Paint touch-up on the driver door",
           "offers":[{"offer_id":"\(offerId)","offer_hash":"\(offerHash)","terms_hash":"\(termsHash)","offer_kind":"individual","offer_rung":"self_claim",
             "provider":{"kind":"user","handle":"fixture_painter"},"performer":{"kind":"actor","label":"unnamed party"},
             "terms":{"lines":[{"description":"Spot blend driver door","pricing_basis":"flat","amount":380,"currency":"USD","unit":null,"quantity":null}]},
             "available_from":null,"available_until":null,"offered_at":"2026-10-19T09:00:00Z","note":null,
             "co_signs":[{"cosign_id":"cs1","co_signer":{"kind":"organization","organization_id":"o1","name":"Fixture Garage"},
                          "kinds":["permission","supervision"],"scope":"Spot blend in our booth this week","cut":{"basis":"share_of_labor_line","percentage":10},
                          "signed_at":"2026-10-19T10:00:00Z","attribution":"authenticated_sign","binding":"on_offer_acceptance"},
                         {"cosign_id":"cs2","co_signer":{"kind":"user","label":"unnamed party"},"kinds":["availability"],"scope":"Available Saturday",
                          "cut":{"basis":"day_rate","amount":40,"currency":"USD","unit":"day"},"signed_at":"2026-10-19T10:30:00Z"}],
             "acceptance":{"state":"not_accepted","accepted_at":null,"role":null},"attribution":"authenticated_sign"}]}],
         "accepted_providers":[],"accepted_cosigners":[],
         "viewer":{"context":"\(customer ? "client" : "provider")","slots":\(customer ? #"["customer"]"# : "[]"),"party":\(customer),"actions":\(actions)},
         "payment_authorized":false,"disbursement":"not_performed"}
        """
    }

    static let changeOrderQuotes = """
    {"work_order_id":"\(workOrderId)","as_of":"2026-10-19T12:00:00Z","display_title":"Exhaust fabrication",
     "current_quote":{"quote_id":"q3","version":3,"supersedes_quote_id":"q2","quote_hash":"\(String(repeating: "3a", count: 32))",
       "is_change_order":true,
       "change_order":{"base_quote_id":"q2","base_quote_hash":"h2","reason":"Stainless was back-ordered; customer asked for mild steel.",
         "changes":[
          {"action":"substitute","base_line_index":0,"new_line_index":0,
           "from_line":{"ref_kind":"operation","ref_id":"o1","description":"Fabricate exhaust","pricing_basis":"flat","amount":1200,"currency":"USD"},
           "to_line":{"ref_kind":"operation","ref_id":"o1","description":"Fabricate exhaust","pricing_basis":"flat","amount":900,"currency":"USD"},
           "specification":{"specification_id":"sp1","field":"material","from_key":"stainless_304","from_label":"304 stainless TIG","to_key":"mild_steel","to_label":"mild steel MIG"}},
          {"action":"modify","base_line_index":1,"new_line_index":1,
           "from_line":{"ref_kind":"labor","ref_id":"l1","description":"Labor","pricing_basis":"hourly","amount":160,"currency":"USD","unit":"hour","quantity":3},
           "to_line":{"ref_kind":"labor","ref_id":"l1","description":"Labor","pricing_basis":"hourly","amount":160,"currency":"USD","unit":"hour","quantity":4}},
          {"action":"remove","base_line_index":2,"from_line":{"ref_kind":"fee","ref_id":null,"description":"Road test","pricing_basis":"day_rate","amount":400,"currency":"USD","unit":"day"}},
          {"action":"add","new_line_index":2,"to_line":{"ref_kind":"fee","ref_id":null,"description":"Heat shields","pricing_basis":"flat","amount":120,"currency":"USD"}}]},
       "quoting_party":{"kind":"user","handle":"fixture_shop","attribution":"authenticated_sign"},"valid_until":null,"expired":false,
       "scope_snapshot":{"operations":[],"specifications":[{"id":"sp1","material_key":"mild_steel","material_label":"mild steel MIG","process_key":"mig","process_label":"MIG"}]},
       "lines":[{"ref_kind":"operation","ref_id":"o1","description":"Fabricate exhaust","pricing_basis":"flat","amount":900,"currency":"USD"},
                {"ref_kind":"labor","ref_id":"l1","description":"Labor","pricing_basis":"hourly","amount":160,"currency":"USD","unit":"hour","quantity":4},
                {"ref_kind":"fee","ref_id":null,"description":"Heat shields","pricing_basis":"flat","amount":120,"currency":"USD"}],
       "unpriced_lines":0,"totals_by_currency":[{"currency":"USD","total":1660,"complete":true}],"deposit_requested":null,"scope_status":"matches_current"},
     "history":[],"acceptance":{"state":"not_accepted"},
     "change_order":{"quote_id":"q3","version":3,"base_quote_id":"q2","changes":4},
     "viewer":{"context":"client","slots":["customer"],"party":true,
       "actions":[{"action":"accept_quote","rpc":"accept_work_order_quote","args":{"p_quote_id":"q3","p_quote_hash":"\(String(repeating: "3a", count: 32))"}}],
       "issuer_actions":[]}}
    """

    /// The quoting shop's view of an accepted quote it can amend.
    static let acceptedForIssuer = """
    {"work_order_id":"\(workOrderId)",
     "current_quote":{"quote_id":"q2","version":2,"quote_hash":"h2","is_change_order":false,"change_order":null,
       "scope_snapshot":{"specifications":[{"id":"sp1","material_key":"stainless_304","material_label":"304 stainless TIG","process_key":"tig","process_label":"TIG"}]},
       "lines":[{"ref_kind":"operation","ref_id":"o1","description":"Fabricate exhaust","pricing_basis":"flat","amount":1200,"currency":"USD"},
                {"ref_kind":"labor","ref_id":"l1","description":"Labor","pricing_basis":"hourly","amount":160,"currency":"USD","unit":"hour","quantity":3},
                {"ref_kind":"fee","ref_id":null,"description":"Road test","pricing_basis":"day_rate","amount":400,"currency":"USD","unit":"day"}],
       "totals_by_currency":[]},
     "acceptance":{"state":"accepted","accepted_by_viewer":false,"quote_version":2},
     "viewer":{"context":"provider","slots":["quoting_party"],"party":true,"actions":[],
       "issuer_actions":[{"action":"issue_change_order","rpc":"issue_change_order","args":{"p_work_order_id":"\(workOrderId)","p_base_quote_id":"q2"}}]}}
    """

    static let vouches = """
    {"viewer":{"context":"visitor","slots":[]},"subject":{"kind":"user","profile_id":"p1","handle":"fixture_tech"},
     "claims":{"account":{"profession":"restoration"},"actor_records":[]},"capabilities":{"items":[]},
     "tools":{"co_signed":{"supporting_attestations":3,"authenticated_attestations":2}},
     "vouched_for_by":{"items":[
       {"vouch_id":"v1","voucher":{"kind":"organization","organization_id":"o1","name":"Fixture Garage"},"kinds":["suitability","supervision"],
        "scope":"Worked under our lead on K5 wiring for a year","vouched_at":"2026-10-01T00:00:00Z","expires_at":"2027-04-01T00:00:00Z",
        "subject":"account","attribution":"authenticated_sign","is_mine":true,"actions":[{"action":"withdraw_vouch","rpc":"withdraw_vouch","args":{"p_id":"v1"}}]},
       {"vouch_id":"v2","voucher":{"kind":"user","label":"unnamed party"},"kinds":["availability"],"scope":null,"vouched_at":"2026-10-10T00:00:00Z"}],
       "basis":"standing vouches; not skill evidence"},
     "facilities":[],"work_record":{},"contact":{"action":"contact_via_nuke","available":false}}
    """
}
