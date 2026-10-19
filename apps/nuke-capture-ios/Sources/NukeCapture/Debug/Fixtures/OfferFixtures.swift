// OfferFixtures.swift — open_requirements_read and work_order_offers_read JSON for tests.
// DEBUG-only (unit tests and the UI-test fixture backend); never compiled into Release. Keys mirror pg_get_functiondef on 2026-10-19; values synthetic.
// Nothing here is ever sent to production.

#if DEBUG
enum OfferFixtures {
    static let reqSkill = "00000000-0000-4000-8000-0000000000d1"
    static let reqTool = "00000000-0000-4000-8000-0000000000d2"
    static let offerId = "00000000-0000-4000-8000-0000000000e9"
    static let offerHash = String(repeating: "cd", count: 32)

    private static let header = """
    "vehicle_label":{"year":1983,"make":"GMC","model":"K2500","trim":"Sierra Classic","text":"1983 GMC K2500 Sierra Classic"},
    "display_title":"Pre-delivery work","display_title_basis":"title","request_source_label":"Requested on the web"
    """

    static func open(signedIn: Bool) -> String {
        let skillMatch = signedIn ? """
        [{"input":"skill","result":"unknown","reason":"no evidenced identity bridge; capability records belong to work actors"},
         {"input":"tools","result":"pass","reason":"not required for a skill requirement"},
         {"input":"facility","result":"pass","reason":"not required for a skill requirement"},
         {"input":"area","result":"pass","reason":"same state and city"},
         {"input":"availability","result":"unknown","reason":"no standing availability is recorded yet"},
         {"input":"evidence_rung","result":"unknown","reason":"self-claimed provider link awaiting evidence"}]
        """ : "null"
        let toolMatch = signedIn ? """
        [{"input":"skill","result":"pass","reason":"not required for a tool requirement"},
         {"input":"tools","result":"pass","reason":"claimed tool record named in the requirement: welder (claimed ownership, not physical verification)"},
         {"input":"facility","result":"pass","reason":"not required for a tool requirement"},
         {"input":"area","result":"unknown","reason":"your public profile states no area"},
         {"input":"availability","result":"unknown","reason":"no standing availability is recorded yet"},
         {"input":"evidence_rung","result":"fail","next":"claim_provider_link","reason":"no provider link claim"}]
        """ : "null"
        return """
        {"viewer":{"context":"\(signedIn ? "provider" : "visitor")","slots":[]},"as_of":"2026-10-19T10:00:00Z",
         "rows":[
          {\(header),"requirement_id":"\(reqSkill)","requirement_kind":"skill","description":"Paint touch-up on the driver door",
           "quantity":null,"unit":null,"work_order_id":"00000000-0000-4000-8000-000000000001","work_order_status":"in_progress",
           "specifications":[{"stage":"requested","material_label":"Single-stage enamel","process_label":"Spot blend"}],
           "area_band":{"city":"Fixture City","state":"NV","basis":"public vehicle city/state"},
           "window":null,"candidates_listed":0,"candidate_acceptance":"not_recorded",
           "quote_state":{"has_current_quote":false,"quote_versions":0,"acceptance":"not_accepted"},
           "match":\(skillMatch)},
          {\(header),"requirement_id":"\(reqTool)","requirement_kind":"tool","description":"MIG welder for exhaust hangers",
           "quantity":1,"unit":"each","work_order_id":"00000000-0000-4000-8000-000000000001","work_order_status":"in_progress",
           "specifications":[],"area_band":null,
           "window":{"available_from":"2026-10-25T00:00:00Z","available_until":"2026-11-01T00:00:00Z","basis":"stated by listed candidates"},
           "candidates_listed":1,"candidate_acceptance":"not_recorded",
           "quote_state":{"has_current_quote":true,"quote_versions":1,"acceptance":"not_accepted"},
           "match":\(toolMatch)},
          {"requirement_kind":"no id"}
         ],
         "next_after":null,
         "match_basis":"\(signedIn ? "explainable per-input join over your evidence; no score, nothing disqualifies" : "sign in to see how your evidence matches each requirement")",
         "coverage":{"returned":2,"total_open":2,"kind_filter":null,
                     "population":{"requirements_total":3,"work_orders_with_requirements":2,"open_work_orders_with_requirements":1,"open_requirements":2},
                     "rule":"current requirement; open work order; public vehicle","not_assessed":["candidate acceptance","distance","standing availability","price"]},
         "contact":{"action":"contact_via_nuke","available":\(signedIn),
                    "request":{"writer":"request_contact","context_kind":"requirement","context_id":"requirement_id of the row"},
                    "basis":"contact between users is brokered by Nuke"}}
        """
    }

    static var offers: String { offersView(provider: false) }

    /// The customer's view (accept) or the offering provider's view (withdraw) of the same job.
    static func offersView(provider: Bool) -> String {
        let actions = provider
            ? #"[{"action":"withdraw_offer","rpc":"withdraw_offer","args":{"p_offer_id":"\#(offerId)"}}]"#
            : #"[{"action":"offer","rpc":"offer_on_requirement","args":{"p_requirement_id":"\#(reqTool)"},"as":{"offer_kind":"individual","offer_rung":"self_claim"}},{"action":"accept_offer","rpc":"accept_offer","args":{"p_offer_id":"\#(offerId)","p_offer_hash":"\#(offerHash)"}}]"#
        return """
    {\(header),"work_order_id":"00000000-0000-4000-8000-000000000001","as_of":"2026-10-19T10:00:00Z","work_order_status":"in_progress",
     "requirements":[
      {"requirement_id":"\(reqSkill)","requirement_kind":"skill","description":"Paint touch-up on the driver door",
       "offers":[
        {"offer_id":"\(offerId)","offer_hash":"\(offerHash)","offer_kind":"individual","offer_rung":"self_claim",
         "provider":{"kind":"user","profile_id":"p9","handle":"fixture_painter"},
         "performer":{"kind":"actor","actor_id":"a9","role":"painter","label":"unnamed party"},"facility":null,
         "terms":{"lines":[{"description":"Spot blend driver door","pricing_basis":"flat","amount":380,"currency":"USD","unit":null,"quantity":null},
                           {"description":"Extra panel time","pricing_basis":"hourly","amount":95,"currency":"USD","unit":"hour","quantity":2}]},
         "available_from":"2026-10-25T00:00:00Z","available_until":"2026-11-01T00:00:00Z","offered_at":"2026-10-19T09:00:00Z",
         "note":"Can come to the shop.","acceptance":{"state":"not_accepted","accepted_at":null,"role":null},"attribution":"authenticated_sign"},
        {"offer_hash":"no id"}
       ]},
      {"requirement_id":"\(reqTool)","requirement_kind":"tool","description":"MIG welder for exhaust hangers","offers":[]}
     ],
     "accepted_providers":[{"assignment_id":"x","offer_id":"y","role":"performer","accepted_at":"2026-10-18T12:00:00Z",
                            "performer":{"kind":"actor","label":"unnamed party"},"provider":{"kind":"user","handle":"fixture_tech"}}],
     "viewer":{"context":"\(provider ? "provider" : "client")","slots":\(provider ? #"["offering_provider"]"# : #"["customer"]"#),
               "money_visible":\(!provider),"party":\(!provider),"actions":\(actions)},
     "coverage":{"requirements":2,"current_offers":1,"withdrawn_or_revised_offers":0},
     "payment_authorized":false,"disbursement":"not_performed"}
    """
    }

    static let offerReceipt = """
    {"offer_id":"\(offerId)","offer_hash":"\(offerHash)","requirement_id":"\(reqSkill)","offer_rung":"self_claim","duplicate":false,
     "payment_authorized":false,"customer_notified":false}
    """
}
#endif
