// ProviderMatchFixtures.swift — work_order_provider_matches_read, work_order_offers_read and provider_profile_read JSON.
// Test-only; never in the app bundle. Keys mirror the live readers on 2026-10-19 (pg_get_functiondef and a read as the
// customer); ids, handles, places and amounts are synthetic. `liveEmpty` is the live envelope with its values replaced:
// every customer-owned job had no requests that day, so the reader returned no providers. Provider rows follow the
// live input helpers (open_requirement_skill/tools/facility/area/availability_input, provider_requirement_match).

enum ProviderMatchFixtures {
    static let workOrderId = "00000000-0000-4000-8000-0000000000a1"
    static let reqSkill = "00000000-0000-4000-8000-0000000000b1"
    static let reqInspect = "00000000-0000-4000-8000-0000000000b2"
    static let techProfile = "00000000-0000-4000-8000-0000000000c1"
    static let shopProfile = "00000000-0000-4000-8000-0000000000c2"
    static let offerTech = "00000000-0000-4000-8000-0000000000e1"
    static let offerUnnamed = "00000000-0000-4000-8000-0000000000e2"
    static let hashTech = String(repeating: "ab", count: 32)
    static let hashUnnamed = String(repeating: "ef", count: 32)

    private static let header = """
    "display_title":"Fixture job","display_title_basis":"title","request_source_label":"Requested on the web",
    "vehicle_label":{"year":1965,"make":"Chevrolet","model":"Corvette","trim":null,"text":"1965 Chevrolet Corvette"}
    """

    private static let envelopeTail = """
    "ranking":"by count of passed inputs only (ties share a rank); every input is shown; nothing is hidden or weighted",
    "inputs":["skill","tools","facility","area","availability","evidence_rung"],
    "people_basis":"people appear by public profile handle, otherwise as unnamed party; contact fields are never returned",
    "payment_authorized":false
    """

    static let liveEmpty = """
    {\(header),"work_order_id":"\(workOrderId)","as_of":"2026-10-19T20:55:17.065817+00:00","providers":[],
     \(envelopeTail),
     "job_area":{"city":"Fixture City","basis":"vehicle city/state","state":"NV"},
     "job_window":{"from":null,"basis":"not_stated","until":null},
     "coverage":{"requirements":0,"candidate_cap":500,"providers_returned":0,"providers_considered":1,
                 "population":"accounts with an evidenced provider link (approved work_evidence, co_sign or authenticated_sign claim) or an active organization membership or ownership; not the reader or the customer",
                 "self_claims":"availability and service area are self-claimed Signs; tools are claimed ownership"},
     "viewer":{"slots":["customer","vehicle_access"],"context":"client","decided_from":"auth.uid()","money_visible":true,
               "contact_visible":false,"identity_bridge":"evidenced","actions":[]}}
    """

    private static let techBand = #"{"city":"Fixture City","state":"NV","radius_miles":25,"mobile":false,"claim_basis":"self_claim"}"#
    private static let shopBand = #"{"city":"Elsewhere","state":"AZ","radius_miles":40,"mobile":true,"claim_basis":"self_claim"}"#
    private static let window = #"{"from":"2026-10-19T21:00:00+00:00","until":"2026-10-30T00:00:00+00:00","basis":"needed_by"}"#

    private static func techInputs(_ kind: String) -> String {
        """
        [{"input":"skill","result":"pass","basis":"evidence_fold","capability_keys":["paint_touch_up"],
          "matched_capabilities":[{"capability":"paint_touch_up","strength":"corroborating","direct":0,"corroborating":2,"against":1}],
          "cautions":[{"kind":"against_evidence","capability":"paint_touch_up","against":1,"reason":"requested and reported-performed specifications differed on earlier work (evidence against, not a verdict)"}],
          "reason":"evidence-derived capability paint_touch_up covers this requirement; with evidence against paint_touch_up"},
         {"input":"tools","result":"pass","reason":"not required for a \(kind) requirement"},
         {"input":"facility","result":"pass","reason":"not required for a \(kind) requirement"},
         {"input":"area","result":"pass","basis":"service_area_city_distance","service_area":\(techBand),
          "reason":"job city is within your 25-mile service area (city-level; self-claimed band)"},
         {"input":"availability","result":"pass","basis":"self_claim","job_window":\(window),"first_available_day":"2026-10-21",
          "reason":"standing availability (self-claimed) falls inside the job window"},
         {"input":"evidence_rung","result":"pass","reason":"evidenced identity bridge"}]
        """
    }

    private static func shopInputs(_ kind: String) -> String {
        """
        [{"input":"skill","result":"unknown","capability_keys":["paint_touch_up"],"matched_capabilities":[],"cautions":[],
          "basis":"no_evidenced_identity_bridge","stated_capabilities":[],"next":"claim_provider_link",
          "reason":"no evidenced identity bridge; capability records belong to work actors"},
         {"input":"tools","result":"pass","reason":"not required for a \(kind) requirement"},
         {"input":"facility","result":"pass","reason":"not required for a \(kind) requirement"},
         {"input":"area","result":"fail","basis":"service_area_city_distance","service_area":\(shopBand),
          "reason":"job city is outside your 40-mile service area (city-level; self-claimed band)"},
         {"input":"availability","result":"fail","basis":"self_claim","job_window":\(window),"reason":"no declared availability inside the job window"},
         {"input":"evidence_rung","result":"fail","reason":"no provider link claim"}]
        """
    }

    private static func unnamedInputs(_ kind: String) -> String {
        """
        [{"input":"skill","result":"unknown","capability_keys":["paint_touch_up"],"matched_capabilities":[],"cautions":[],
          "basis":"stated_not_evidenced","stated_capabilities":["paint_touch_up"],"reason":"stated, not evidenced: paint_touch_up"},
         {"input":"tools","result":"pass","reason":"not required for a \(kind) requirement"},
         {"input":"facility","result":"pass","reason":"not required for a \(kind) requirement"},
         {"input":"area","result":"unknown","reason":"your public profile states no area","next":"set_provider_service_area"},
         {"input":"availability","result":"unknown","reason":"no standing availability is recorded yet","next":"set_provider_availability"},
         {"input":"evidence_rung","result":"unknown","reason":"self-claimed provider link awaiting evidence"}]
        """
    }

    private static func reqs(_ inputs: (String) -> String, passed: (Int, Int)) -> String {
        """
        [{"requirement_id":"\(reqSkill)","requirement_kind":"skill","description":"Paint touch-up on the driver door",
          "capability_keys":["paint_touch_up"],"passed":\(passed.0),"inputs":\(inputs("skill"))},
         {"requirement_id":"\(reqInspect)","requirement_kind":"inspection","description":"Road test after the brake bleed",
          "capability_keys":[],"passed":\(passed.1),"inputs":\(inputs("inspection"))}]
        """
    }

    static let populated = """
    {\(header),"work_order_id":"\(workOrderId)","as_of":"2026-10-19T21:00:00+00:00",
     \(envelopeTail),
     "job_area":{"city":"Fixture City","basis":"vehicle city/state","state":"NV"},
     "job_window":\(window),
     "coverage":{"requirements":2,"candidate_cap":500,"providers_returned":3,"providers_considered":3,
                 "population":"accounts with an evidenced provider link","self_claims":"availability and service area are self-claimed Signs; tools are claimed ownership"},
     "viewer":{"slots":["customer"],"context":"client","actions":[]},
     "providers":[
      {"rank":1,"provider":{"kind":"user","profile_id":"\(techProfile)","handle":"fixture_tech"},"listed_because":["evidenced_link"],
       "link_state":"evidenced","passed":12,"failed":0,"unknown":0,"inputs_total":12,"requirements":\(reqs(techInputs, passed: (6, 6))),
       "contact":{"writer":"request_contact","context_kind":"work_order","context_id":"\(workOrderId)","recipient_user_id":"\(techProfile)"}},
      {"rank":2,"provider":{"kind":"user","label":"unnamed party"},"listed_because":["evidenced_link"],
       "link_state":"claimed","passed":4,"failed":0,"unknown":8,"inputs_total":12,"requirements":\(reqs(unnamedInputs, passed: (2, 2))),
       "contact":null},
      {"rank":2,"provider":{"kind":"user","profile_id":"\(shopProfile)","handle":"Fixture_Shop"},"listed_because":["organization_owner","organization_member"],
       "link_state":"none","passed":4,"failed":6,"unknown":2,"inputs_total":12,"requirements":\(reqs(shopInputs, passed: (2, 2))),
       "contact":null},
      "not a provider row"
     ]}
    """

    /// work_order_offers_read as the customer: an offer from @fixture_tech, one from an unnamed party, nobody accepted.
    static func offers(accepted: Bool = false, slots: String = #"["customer"]"#) -> String {
        let acceptedProviders = accepted
            ? #"[{"role":"performer","accepted_at":"2026-10-19T12:00:00Z","provider":{"kind":"user","handle":"fixture_tech"}}]"#
            : "[]"
        return """
        {\(header),"work_order_id":"\(workOrderId)","as_of":"2026-10-19T21:00:00Z","work_order_status":"pending",
         "requirements":[
          {"requirement_id":"\(reqSkill)","requirement_kind":"skill","description":"Paint touch-up on the driver door","offers":[
            {"offer_id":"\(offerTech)","offer_hash":"\(hashTech)","offer_kind":"individual","offer_rung":"work_evidence",
             "provider":{"kind":"user","profile_id":"\(techProfile)","handle":"fixture_tech"},
             "terms":{"lines":[{"description":"Spot blend driver door","pricing_basis":"flat","amount":380,"currency":"USD"}]},
             "available_from":"2026-10-21T00:00:00Z","available_until":"2026-10-28T00:00:00Z",
             "acceptance":{"state":"not_accepted","accepted_at":null}}]},
          {"requirement_id":"\(reqInspect)","requirement_kind":"inspection","description":"Road test after the brake bleed","offers":[
            {"offer_id":"\(offerUnnamed)","offer_hash":"\(hashUnnamed)","offer_kind":"individual","offer_rung":"self_claim",
             "provider":{"kind":"user","label":"unnamed party"},
             "terms":{"lines":[{"description":"Road test","pricing_basis":"flat","amount":120,"currency":"USD"}]},
             "acceptance":{"state":"not_accepted","accepted_at":null}}]}
         ],
         "accepted_providers":\(acceptedProviders),
         "viewer":{"context":"client","slots":\(slots),"money_visible":true,"actions":[
           {"action":"accept_offer","rpc":"accept_offer","args":{"p_offer_id":"\(offerTech)","p_offer_hash":"\(hashTech)"}},
           {"action":"accept_offer","rpc":"accept_offer","args":{"p_offer_id":"\(offerUnnamed)","p_offer_hash":"\(hashUnnamed)"}}]},
         "payment_authorized":false,"disbursement":"not_performed"}
        """
    }

    /// provider_profile_read for @fixture_tech: declared band and availability, evidence-derived and hand-entered skills.
    static let techFace = """
    {"as_of":"2026-10-19T21:00:00Z",
     "subject":{"kind":"user","profile_id":"\(techProfile)","handle":"fixture_tech","city":"Fixture City","state":"NV",
                "place_basis":"published on the public profile; no street address","member_since":"2025-09-07T08:05:15Z"},
     "service_area":{"state":"declared","claim_basis":"self_claim","declared_at":"2026-10-19T20:00:00Z","city":"Fixture City",
                     "state_code":"NV","radius_miles":25,"mobile":false,"geocoded":true,
                     "place_basis":"city-level band stated by the account; no street address or coordinates"},
     "availability":{"state":"declared","claim_basis":"self_claim","declared_at":"2026-10-19T20:00:00Z","timezone":"America/Los_Angeles",
                     "weekly":[{"dow":1,"start":"08:00","end":"17:00","day":"Mon"},{"dow":2,"start":"08:00","end":"17:00","day":"Tue"},
                               {"dow":6,"start":"09:00","end":"12:00","day":"Sat"}],
                     "exceptions_upcoming":[{"date":"2026-10-27","available":false}],
                     "basis":"standing weekly windows and date exceptions stated by the account (set_provider_availability)"},
     "identity_bridge":{"state":"evidenced","rung":"work_evidence","evidenced_actors":1},
     "capabilities":{"basis":"evidence-derived capability records of the subject's actor(s); self-claims are never counted here","items":[
       {"capability_type":"paint_touch_up","derivation":"evidence_fold","evidence_count":2},
       {"capability_type":"welding_tig","derivation":"evidence_fold","evidence_count":1},
       {"capability_type":"paint_touch_up","derivation":"legacy_hand_entered","evidence_count":2},
       {"capability_type":"upholstery","derivation":"legacy_hand_entered","evidence_count":1}]},
     "vouched_for_by":{"basis":"standing vouches signed by the voucher","items":[]},
     "work_record":{"days":{"signed_work_days":3,"signature_basis":"self-confirmation of a photo-derived day (confirm_work_session); not counterparty acceptance"},
                    "jobs":{"jobs":2,"basis":"provider jobs (shop owner or evidenced performer); completion recorded means a completion clock exists, not client acceptance"}},
     "facilities":[{"organization_id":"o1","name":"Fixture Garage","city":"Fixture City","state":"NV","relation_kind":"ownership","relation":{"state":"dormant"}},
                   {"organization_id":"o2","name":"Old Shop","city":"Elsewhere","state":"AZ","relation_kind":"membership","relation":{"state":"dormant"}}],
     "viewer":{"context":"visitor","slots":[]}}
    """

    /// provider_profile_read with neither Sign declared.
    static let bareFace = """
    {"subject":{"kind":"user","handle":"Fixture_Shop","city":"Elsewhere","state":"AZ"},
     "service_area":{"state":"not_declared","basis":"no set_provider_service_area Sign"},
     "availability":{"state":"not_declared","basis":"no set_provider_availability Sign"},
     "capabilities":{"items":[]},"work_record":{"jobs":{"jobs":0}},"facilities":[]}
    """
}
