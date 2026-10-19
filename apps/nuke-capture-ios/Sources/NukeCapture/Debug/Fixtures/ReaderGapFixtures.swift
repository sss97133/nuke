// ReaderGapFixtures.swift — the readers' new fields from B13, for tests. DEBUG-only (unit tests and the UI-test fixture backend); never compiled into Release.
// Keys mirror pg_get_functiondef (work_order_facility_reservations_read, work_order_facility_actions,
// my_vouches_read, provider_vouches_for_viewer, cosign_acting_for, work_order_quotes_read release_conditions)
// on 2026-10-19; values synthetic. No writer is ever called with these.

#if DEBUG
enum ReaderGapFixtures {
    static let workOrderId = FacilityFixtures.workOrderId
    static let orgId = FacilityFixtures.orgId

    private static let reserveAction = """
    {"action":"reserve_facility","rpc":"reserve_facility","as":"customer",
     "args":{"p_work_order_id":"\(workOrderId)","p_asset_id":null,"p_from":null,"p_until":null,"p_terms":null},
     "facility_requirement_id":"rf1","facilities":[{"kind":"organization","name":"Fixture Garage","organization_id":"\(orgId)"}],
     "assets_from":"facility_read(organization_id): declared assets with busy windows",
     "binds":["a request for one declared asset for the window; it occupies capacity only when the facility confirms"],
     "does_not_bind":["payment","vehicle access","the facility's confirmation"]}
    """

    /// The customer: every request with terms, Book a bay, and Cancel on their own open requests.
    static let reservationsParty = """
    {"work_order_id":"\(workOrderId)","as_of":"2026-10-19T14:00:00Z","reservations":[
      {"reservation_id":"rv1","asset":{"asset_id":"a1","kind":"lift","label":"Lift A","capacity":1},
       "shop":{"kind":"organization","name":"Fixture Garage","organization_id":"\(orgId)"},
       "window":{"from":"2026-10-21T16:00:00+00:00","until":"2026-10-21T19:00:00+00:00"},"state":"confirmed","requester_role":"customer",
       "requested_by":{"kind":"user","handle":"fixture_customer"},"terms":{"basis":"hourly","amount":40,"currency":"USD"},
       "requested_at":"2026-10-19T11:00:00Z","confirmed_at":"2026-10-19T12:00:00Z","cancelled_at":null,"slot":1,"visibility":"party"},
      {"reservation_id":"rv2","asset":{"asset_id":"b1","kind":"bay","label":"Bay 1","capacity":2},
       "shop":{"kind":"organization","name":"Fixture Garage","organization_id":"\(orgId)"},
       "window":{"from":"2026-10-23T15:00:00+00:00","until":"2026-10-23T20:00:00+00:00"},"state":"requested","requester_role":"customer",
       "requested_by":{"kind":"user","handle":"fixture_customer"},"terms":null,"requested_at":"2026-10-19T13:00:00Z","confirmed_at":null,
       "cancelled_at":null,"slot":null,"visibility":"party"},
      {"reservation_id":"rv3","asset":{"asset_id":"a1","kind":"lift","label":"Lift A","capacity":1},
       "shop":{"kind":"organization","name":"Fixture Garage","organization_id":"\(orgId)"},
       "window":{"from":"2026-10-20T16:00:00+00:00","until":"2026-10-20T19:00:00+00:00"},"state":"cancelled","requester_role":"accepted_provider",
       "requested_by":{"kind":"user","label":"unnamed party"},"terms":{"basis":"day_rate","amount":200,"currency":"USD"},
       "requested_at":"2026-10-18T13:00:00Z","confirmed_at":null,"cancelled_at":"2026-10-18T15:00:00Z","slot":null,"visibility":"party"}],
     "viewer":{"context":"client","slots":["customer"],"party":true,"actions":[\(reserveAction),
       {"action":"cancel_facility_reservation","rpc":"cancel_facility_reservation","args":{"p_reservation_id":"rv1"}},
       {"action":"cancel_facility_reservation","rpc":"cancel_facility_reservation","args":{"p_reservation_id":"rv2"}}]},
     "coverage":{"reservations":3,"visibility":"parties, the requester and facility members see every request with terms"},
     "payment_authorized":false}
    """

    /// A visitor: confirmed busy windows only, no ids, no terms, no actions.
    static let reservationsVisitor = """
    {"work_order_id":"\(workOrderId)","reservations":[
      {"asset":{"kind":"lift","label":"Lift A"},"shop":{"kind":"organization","name":"Fixture Garage","organization_id":"\(orgId)"},
       "window":{"from":"2026-10-21T16:00:00+00:00","until":"2026-10-21T19:00:00+00:00"},"state":"confirmed","visibility":"busy_window_only"}],
     "viewer":{"context":"visitor","slots":[],"party":false,"actions":[]},"payment_authorized":false}
    """

    static let myVouches = """
    {"viewer":{"context":"self","slots":[]},"as_of":"2026-10-19T14:00:00Z","items":[
      {"vouch_id":"v1","subject":{"kind":"user","handle":"fixture_tech","subject_kind":"account"},
       "voucher":{"kind":"organization","organization_id":"o1","name":"Fixture Garage"},"signed_by_me":true,"kinds":["supervision","suitability"],
       "scope":"Worked under our lead on K5 wiring","signed_at":"2026-10-01T00:00:00Z","expires_at":"2027-04-01T00:00:00Z","status":"active",
       "withdrawn_at":null,"actions":[{"action":"withdraw_vouch","rpc":"withdraw_vouch","args":{"p_id":"v1"}}]},
      {"vouch_id":"v2","subject":{"kind":"actor","label":"unnamed party","subject_kind":"work_actor"},"voucher":{"kind":"user","label":"you"},
       "signed_by_me":true,"kinds":["availability"],"scope":null,"signed_at":"2026-09-01T00:00:00Z","expires_at":null,"status":"withdrawn",
       "withdrawn_at":"2026-09-15T00:00:00Z","actions":[]}],
     "coverage":{"returned":2,"limit":200},"basis":"a vouch is a standing statement with scope; never skill evidence"}
    """

    static let quotesWithRelease = """
    {"work_order_id":"\(workOrderId)","as_of":"2026-10-19T14:00:00Z",
     "release_conditions":{"current":[{"kind":"customer_completion_sign"},{"kind":"days_signed","days":7},{"kind":"photos_in_window"}],
                           "accepted":null,"declared_by":"platform_standard"},
     "current_quote":{"quote_id":"q1","version":1,"quote_hash":"\(String(repeating: "4c", count: 32))",
       "quoting_party":{"kind":"user","handle":"fixture_shop"},"lines":[{"description":"Brake service","pricing_basis":"flat","amount":480,"currency":"USD"}],
       "totals_by_currency":[{"currency":"USD","total":480,"complete":true}],
       "release_conditions":[{"kind":"customer_completion_sign"},{"kind":"days_signed","days":7},{"kind":"photos_in_window"}]},
     "history":[],"acceptance":{"state":"not_accepted"},
     "viewer":{"context":"client","slots":["customer"],"party":true,
       "actions":[{"action":"accept_quote","rpc":"accept_work_order_quote","args":{"p_quote_id":"q1","p_quote_hash":"\(String(repeating: "4c", count: 32))"}}],
       "issuer_actions":[]}}
    """
}
#endif
