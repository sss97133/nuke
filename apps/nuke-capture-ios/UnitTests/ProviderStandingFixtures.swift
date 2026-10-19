// ProviderStandingFixtures.swift — provider_productivity_read, actor_link_claim_evidence_read and
// owner_delegated_signs_read JSON for tests. Test-only; never in the app bundle.
// Shapes captured read-only from production on 2026-10-19 (pg_get_functiondef and live calls); ids,
// handles and vehicle labels replaced with synthetic values. Production held no day-rate jobs that
// day, so `day_rate_jobs` follows the function definition.

enum ProviderStandingFixtures {
    static let userId = "00000000-0000-4000-8000-0000000000c1"
    static let claimId = "00000000-0000-4000-8000-0000000000d1"

    static func productivity(isSelf: Bool) -> String {
        """
        {"days":[
           {"day":"2026-10-17","signed":{"self_confirmed":false,"customer_accepted":false},"image_evidence":1,
            "capture_span_minutes":null,"completions_accepted":0,"operations_completed":0,"specs_reported_performed":0},
           {"day":"2026-10-15","signed":{"self_confirmed":true,"customer_accepted":true},"image_evidence":61,
            "capture_span_minutes":190,"completions_accepted":1,"operations_completed":2,"specs_reported_performed":1},
           {"day":"2026-10-14","signed":{"self_confirmed":true,"customer_accepted":false},"image_evidence":2,
            "capture_span_minutes":"45","completions_accepted":0,"operations_completed":0,"specs_reported_performed":0},
           {"signed":{"self_confirmed":true}}],
         "as_of":"2026-10-19T19:02:57.783494+00:00",
         "basis":{"money":"day rates are open terms; totals, payouts and payments are never shown",
                  "visibility":"\(isSelf ? "self: all own activity" : "public vehicles and gate-cleared photos only; no vehicle ids")",
                  "not_adopted":["equipment_usage_evidence minutes","technician_work_evidence durations","any inferred minutes"],
                  "self_confirmed":"the subject confirmed the work day (confirm_work_session)",
                  "customer_accepted":"a work-session day inside the window of a job whose provider completion by the subject the customer accepted",
                  "capture_span_minutes":"span between the first and last photo of a work session; not labor time"},
         "range":{"to":"2026-10-19","from":"2026-07-21"},
         "totals":{"days_with_activity":9,"self_confirmed_days":2,"completions_accepted":1,"operations_completed":2,"customer_accepted_days":1},
         "viewer":{"self":\(isSelf),"decided_from":"auth.uid()"},
         "subject":{"kind":"user","handle":"fixture_tech","profile_id":"\(userId)"},
         "day_rate_jobs":[
           {"work_order_id":"00000000-0000-4000-8000-0000000000e1","display_title":"Fixture brake job",
            "day_rate_terms":[{"source":"accepted_quote","ref_id":"00000000-0000-4000-8000-0000000000f1","description":"Shop day",
                               "rate":200,"currency":"USD","quantity_days":3}],
            "days_agreed":3,
            "signed_days":{"self_confirmed":2,"customer_accepted":1,
                           "window":{"from":"2026-10-13T15:31:54+00:00","until":"2026-10-16T16:30:23+00:00",
                                     "from_basis":"start_clock","until_basis":"completion_clock_plus_1_day"}},
            "basis":"accepted day-rate terms (rates open) against days the subject signed inside the job window; no totals or payments"},
           {"display_title":"missing id"}],
         "payment_authorized":false}
        """
    }

    static let claimEvidence = """
    {"as_of":"2026-10-19T19:03:26.048285+00:00",
     "claim":{"rung":"work_evidence",
              "actor":{"kind":"user","basis":"evidenced_identity_bridge","handle":"fixture_tech",
                       "actor_id":"00000000-0000-4000-8000-0000000000a1","profile_id":"\(userId)"},
              "status":"approved","claim_id":"\(claimId)","filed_at":"2026-10-19T17:14:21.282389+00:00"},
     "items":[
       {"why":"your work session on the vehicle of a component event attributed to the actor, on the same day","date":"2026-03-16",
        "kind":"work_session","row_id":"00000000-0000-4000-8000-000000000101","strength":"direct",
        "vehicle_label":"1983 Fixture Truck","approvable_for":["work_evidence"]},
       {"why":"your work session on the vehicle of a component event attributed to the actor, on the same day","date":"2026-03-15",
        "kind":"work_session","row_id":"00000000-0000-4000-8000-000000000102","strength":"direct",
        "vehicle_label":"1983 Fixture Truck","approvable_for":["work_evidence"]},
       {"why":"analysis of your photo of the vehicle during a component event attributed to the actor","date":"2026-03-16",
        "kind":"observation","row_id":"00000000-0000-4000-8000-000000000103","strength":"corroborating",
        "vehicle_label":"1983 Fixture Truck","approvable_for":[]},
       {"why":"you are an active member of verified organization Fixture Garage, which the actor worked for","date":null,
        "kind":"org_membership","row_id":"00000000-0000-4000-8000-000000000104","strength":"corroborating",
        "vehicle_label":null,"approvable_for":[]},
       {"why":"row without an id","kind":"observation"}],
     "counts":{"total":37,"direct":2,"by_kind":{"observation":35,"work_session":2},"corroborating":35},
     "viewer":{"role":"claimant"},
     "approval":{"access":"service role with a distinct active admin reviewer","writer":"approve_actor_link_claim",
                 "auto_approved":false,"work_evidence_needs":"at least one work_session item"},
     "not_assessed":["whether the claimant is the person who did the work (reviewer judgement)","who appears in photos",
                     "name, phone or e-mail similarity (never used)","photos beyond 200 per operation"]}
    """

    static func delegatedSigns(ownerId: String = userId) -> String {
        """
        {"as_of":"2026-10-19T19:03:34.173163+00:00",
         "owner":{"kind":"user","handle":"fixture_owner","profile_id":"\(ownerId)"},
         "by_rpc":[
           {"rpc":"account_link_claims_self_claim","signs":1,"rolled_back":0,
            "last_signed_at":"2026-10-19T17:14:21.387276+00:00","first_signed_at":"2026-10-19T17:14:21.387276+00:00"},
           {"rpc":"confirm_work_session","signs":2,"rolled_back":1,
            "last_signed_at":"2026-10-19T16:49:50+00:00","first_signed_at":"2026-10-19T16:40:00+00:00"},
           {"signs":3}],
         "recent":[
           {"rpc":"confirm_work_session","signed_at":"2026-10-19T16:49:50+00:00","rolled_back":true,"authorized_at":"2026-10-19T16:09:00+00:00"},
           {"rpc":"account_link_claims_self_claim","signed_at":"2026-10-19T17:14:21.387276+00:00","rolled_back":false,
            "authorized_at":"2026-10-19T16:09:00+00:00"}],
         "totals":{"signs":5,"rolled_back":1},
         "meaning":"each Sign here was executed by an agent on the owner's behalf under his recorded authorization and registered in the same transaction",
         "withheld":["arguments","result references","agent sessions","authorization wording"],
         "authorizations":["2026-10-19T16:09:00+00:00"]}
        """
    }
}
