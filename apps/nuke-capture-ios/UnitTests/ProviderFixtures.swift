// ProviderFixtures.swift — provider_profile_read / provider_job_record_read JSON for tests.
// Test-only; never in the app bundle. Keys mirror pg_get_functiondef on 2026-10-19; values synthetic.

enum ProviderFixtures {
    static let userId = "00000000-0000-4000-8000-0000000000c1"

    static func profile(context: String) -> String {
        """
        {"viewer":{"context":"\(context)","slots":[],"money_visible":false,"contact_visible":false,"decided_from":"auth.uid()","identity_bridge":"none"},
         "as_of":"2026-10-19T09:00:00Z",
         "subject":{"kind":"user","profile_id":"\(userId)","handle":"fixture_tech","label":null,"actor_type":null,
                    "city":"Fixture City","state":"NV","place_basis":"published on the public profile; no street address",
                    "member_since":"2025-03-01T00:00:00Z"},
         "claims":{"basis":"stated_by_account",
                   "account":{"role":"mechanic","user_type":"professional","profession":"restoration","expertise_areas":["engines","fabrication"]},
                   "actor_records":[{"actor_id":"a1","basis":"stated_on_actor_record","actor_type":"mechanic","specialties":["Square-body trucks"],
                                     "certifications":null,"licenses":[],"training":"not-an-array","specialty_makes":["GMC","Chevrolet"],
                                     "specialty_eras":["1973-1987"],"years_experience":12}]},
         "capabilities":{"items":[
           {"actor_id":"a1","capability_type":"engine_rebuild","complexity_tier":"advanced","evidence_count":14,
            "first_demonstrated":"2025-04-02","last_demonstrated":"2026-09-30","basis_ids_recorded":0},
           {"actor_id":"a1","capability_type":"exhaust_fabrication","complexity_tier":null,"evidence_count":1,
            "first_demonstrated":"2026-06-01","last_demonstrated":"2026-06-01","basis_ids_recorded":0},
           {"broken":"row"}],
           "basis":"evidence-derived capability records of the subject's actor(s); self-claims are never counted here"},
         "tools":{"seen_in_frame":{"occurrences":312,"frames_analyzed":420,"frames_with_tools":181,
                                   "top_labels":[{"label":"floor jack","occurrences":44},{"label":"welder","occurrences":30}],
                                   "images_scanned":1000,"images_eligible":3200,"scan_cap":1000,
                                   "basis":"tool sightings in analysed frames of the subject's own approved photos; occurrences, not distinct objects"},
                  "claimed_owned":{"user_tools":[{"category":"hand tools","records":40,"units":55},{"category":"diagnostic","records":3,"units":3}],
                                   "tool_inventory":[{"category":"hand tools","records":2}],
                                   "basis":"claimed ownership from receipts and inventory records; not physical verification",
                                   "values":"not reported here (purchase cost, computed depreciation and market value are separate measures)"},
                  "co_signed":{"supporting_attestations":0,"basis":"supporting statements by someone other than the subject"}},
         "facilities":[
           {"relation_kind":"member","organization_id":"o1","name":"Fixture Garage","type":"shop","role":"technician","membership_status":"active",
            "city":"Fixture City","state":"NV","relation":{"weight":0.6,"state":"live","last_contribution_at":"2026-10-18T20:00:00Z"},
            "actor_profile":{"reader":"actor_profile_read","kind":"organization","id":"o1"}},
           {"relation_kind":"member","organization_id":"o2","name":"Old Side Project","role":"contributor",
            "relation":{"weight":0.0,"state":"dormant","last_contribution_at":"2025-01-01T00:00:00Z"}},
           {"relation_kind":"ownership","organization_id":"o3","name":"Fixture Fab LLC","role":"owner","membership_status":"active",
            "city":null,"state":null,"relation":null,"actor_profile":null}],
         "identity_bridge":{"state":"claimed","rung":"self_claim","evidenced_actors":0,"basis":"account_link_claims actor claims"},
         "work_record":{
           "days":{"signed_work_days":2,"days_with_capture":809,
                   "capture_span_hours":{"value":1395.9,"label":"capture span from photo timestamps; not labor time"},
                   "first_day":"2024-01-02","last_day":"2026-10-18","signature_basis":"self-confirmation"},
           "jobs":{"jobs":3,"by_role":{"shop_owner":2,"performer":1},"completion":{"recorded":1,"status_only":1,"absent":1},
                   "in_progress":1,"inconsistencies":2,"basis":"provider jobs","detail_reader":"provider_job_record_read"}},
         "contact":{"action":"contact_via_nuke","available":false,"basis":"contact between users is brokered by Nuke"},
         "coverage":{"claims":"what the account or actor record states; not verified"},
         "money":"not_reported"}
        """
    }

    static let actorProfile = """
    {"viewer":{"context":"visitor","slots":[]},"as_of":"2026-10-19T09:00:00Z",
     "subject":{"kind":"actor","actor_id":"a9","actor_type":"painter",
                "display":{"kind":"actor","actor_id":"a9","role":"painter","label":"unnamed party"},
                "city":null,"state":null,"place_basis":"not published by the subject","member_since":null},
     "claims":{"basis":"stated_on_actor_record","account":null,"actor_records":[{"actor_type":"painter","specialties":["Single stage"]}]},
     "capabilities":{"items":[]},
     "tools":{"seen_in_frame":{"state":"not_assessed","basis":"a work actor has no photo account"},
              "claimed_owned":{"state":"not_assessed","basis":"a work actor has no tool records"},
              "co_signed":{"supporting_attestations":1}},
     "facilities":[],"identity_bridge":{"state":"none","rung":null},
     "work_record":{"days":{"state":"not_assessed","basis":"work days belong to accounts"},
                    "jobs":{"jobs":0,"by_role":{},"completion":{"recorded":0,"status_only":0,"absent":0},"in_progress":0,"inconsistencies":0}},
     "contact":{"action":"contact_via_nuke","available":false},"money":"not_reported"}
    """

    static let jobRecord = """
    {"viewer":{"context":"visitor","slots":[]},"as_of":"2026-10-19T09:00:00Z",
     "subject":{"kind":"user","profile_id":"\(userId)","handle":"fixture_tech","label":null},
     "rows":[
      {"vehicle_label":{"year":1983,"make":"GMC","model":"K2500","trim":"Sierra Classic","text":"1983 GMC K2500 Sierra Classic"},
       "display_title":"Exhaust fabrication","display_title_basis":"title","request_source_label":"Requested on the web",
       "work_order_id":"00000000-0000-4000-8000-000000000001","vehicle_id":"v1","subject_roles":["shop_owner"],
       "stage_states":{"intake":"recorded","inspection":"absent","plan":"partial","terms":"partial","execution":"recorded","completion":"recorded","accounting":"withheld"},
       "operation_kinds":{"install":3,"paint":1},
       "dates":{"requested_at":"2026-10-02T17:04:11Z","quote_clock":null,"approval_clock":null,"start_clock":"2026-10-05T15:00:00Z","completion_clock":"2026-10-09T15:00:00Z"},
       "customer_acceptance":"signed",
       "counterparty_attestations":[{"attestation_kind":"supervision","verdict":"supports","scope":"job","observed_at":"2026-10-09T16:00:00Z",
                                     "attestor":{"kind":"user","label":"unnamed party"},"attestor_basis":"attributed_by_source_testimony"}],
       "inconsistencies":["completion:done_status_without_completion_clock"],"as_of":"2026-10-19T09:00:00Z"},
      {"work_order_id":"00000000-0000-4000-8000-000000000002","display_title":null,"vehicle_label":{"text":"1969 Ford Mustang"},
       "subject_roles":["performer"],"stage_states":{"intake":"partial"},"operation_kinds":{},"dates":{},
       "customer_acceptance":"not_established","counterparty_attestations":[],"inconsistencies":[]},
      {"no":"id"}
     ],
     "next_after":"00000000-0000-4000-8000-000000000002",
     "coverage":{"returned":2,"total_for_subject":5,"withheld":["accounting: payments and balances","customer identity"]},
     "money":"not_reported"}
    """
}
