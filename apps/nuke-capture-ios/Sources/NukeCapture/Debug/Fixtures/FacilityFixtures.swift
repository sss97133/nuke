// FacilityFixtures.swift — shop space, bookings and the facility input for tests. DEBUG-only (unit tests and the UI-test fixture backend); never compiled into Release.
// Keys mirror pg_get_functiondef (facility_read, reserve_facility, confirm_facility_reservation,
// signature_queue_facility_items, open_requirement_facility_input) on 2026-10-19; values synthetic.
// No writer is ever called with these.

#if DEBUG
enum FacilityFixtures {
    static let orgId = "00000000-0000-4000-8000-0000000000f1"
    static let workOrderId = "00000000-0000-4000-8000-000000000001"
    static let liftA = "00000000-0000-4000-8000-00000000a001"
    static let reservationId = "00000000-0000-4000-8000-00000000r001".replacingOccurrences(of: "r", with: "e")
    static let hash = String(repeating: "5e", count: 16)

    static func read(party: Bool) -> String {
        let ids = party ? #","reservation_id":"\#(reservationId)","work_order_id":"\#(workOrderId)""# : ""
        let actions = party ? #"[{"action":"declare_facility_asset","rpc":"declare_facility_asset","args":{"p_organization_id":"\#(orgId)"}}]"# : "[]"
        return """
        {"organization":{"kind":"organization","name":"Fixture Garage","organization_id":"\(orgId)"},"as_of":"2026-10-19T12:00:00Z",
         "assets_by_kind":[
          {"kind":"bay","capacity_total":2,"assets":[{"asset_id":"b1","label":"Bay 1","capacity":2,"declared_at":"2026-10-01T00:00:00Z","evidence_count":0,"basis":"member_declaration","busy":[]}]},
          {"kind":"lift","capacity_total":2,"assets":[
            {"asset_id":"\(liftA)","label":"Lift A","capacity":1,"declared_at":"2026-10-01T00:00:00Z","evidence_count":1,"basis":"member_declaration",
             "busy":[{"from":"2026-10-21T16:00:00+00:00","until":"2026-10-21T19:00:00+00:00","slot":1\(ids)},
                     {"from":"2026-10-28T15:00:00+00:00","until":"2026-10-30T23:00:00+00:00","slot":1}]},
            {"asset_id":"l2","label":"Lift B","capacity":1,"busy":[]},
            {"label":"no id"}]}],
         "licenses":[
          {"license_type":"auto_repair","issuing_authority":"State of Nevada","expiration_date":"2027-03-01","is_active":true,"verified":false,"state":"active"},
          {"license_type":"paint_spray","issuing_authority":null,"expiration_date":null,"is_active":true,"verified":true,"state":"active_expiry_unknown"},
          {"license_type":"smog_check","issuing_authority":"State of Nevada","expiration_date":"2025-01-31","is_active":true,"verified":false,"state":"expired"}],
         "members":[{"kind":"user","handle":"fixture_owner","profile_id":"p1","relation":"owner","weight":2},
                    {"kind":"user","handle":"fixture_tech","profile_id":"p2","relation":"member","weight":1}],
         "members_unnamed":1,
         "calendar":{"from":"2026-10-19T12:00:00Z","until":"2026-12-18T12:00:00Z","basis":"confirmed reservations only"},
         "coverage":{"declared_assets":3,"photo_inferred_not_declared":4,"licenses":3},
         "viewer":{"role":\(party ? "\"organization_owner\"" : "null"),"party":\(party),"decided_from":"auth.uid()","actions":\(actions)},
         "payment_authorized":false}
        """
    }

    static let empty = """
    {"organization":{"kind":"organization","name":"Nuke","organization_id":"f1"},"assets_by_kind":[],"licenses":[],"members":[],
     "members_unnamed":1,"viewer":{"role":null,"party":false,"actions":[]},"payment_authorized":false}
    """

    /// open_requirements_read rows: a facility requirement with a free lift, one fully booked, one with nothing declared.
    static let open = """
    {"viewer":{"context":"provider","slots":[]},"rows":[
      {"requirement_id":"rf1","requirement_kind":"facility","description":"A lift for two days to drop the transmission","work_order_id":"\(workOrderId)",
       "match":[{"input":"skill","result":"pass","reason":"not required for a facility requirement"},
                {"input":"facility","result":"pass","kinds":["lift"],
                 "assets":[{"asset_id":"\(liftA)","kind":"lift","label":"Lift A","capacity":1,"organization":{"kind":"organization","organization_id":"\(orgId)","name":"Fixture Garage"},"free_in_window":true},
                           {"asset_id":"l2","kind":"lift","label":"Lift B","capacity":1,"organization":{"kind":"organization","organization_id":"\(orgId)","name":"Fixture Garage"},"free_in_window":true}],
                 "window":{"from":"2026-10-21T16:00:00Z","until":"2026-10-23T00:00:00Z","basis":"job schedule"},
                 "reason":"declared matching asset with a free slot in the window at a reachable facility"}]},
      {"requirement_id":"rf2","requirement_kind":"facility","description":"Paint booth for a weekend","work_order_id":"w2",
       "match":[{"input":"facility","result":"fail","next":"plan_b_supplier_needed","kinds":["paint_booth"],
                 "window":{"from":"2026-10-24T00:00:00Z","until":"2026-10-26T00:00:00Z","basis":"job schedule"},
                 "reason":"every declared matching asset at reachable facilities is booked in the window"}]},
      {"requirement_id":"rf3","requirement_kind":"facility","description":"A bay","work_order_id":"w3",
       "match":[{"input":"facility","result":"unknown","next":"plan_b_supplier_needed","kinds":["bay"],"reachable_facilities":0,
                 "reason":"no declared bay at a reachable facility (your organizations, the job's shop or a proposed facility)"}]},
      {"requirement_id":"rs1","requirement_kind":"skill","description":"Paint","work_order_id":"w4","match":null}]}
    """

    static let queue = """
    {"items":[{"kind":"facility_reservation_to_confirm","ref_id":"\(reservationId)","work_order_id":"\(workOrderId)",
      "display_title":"Transmission swap","vehicle_label":{"text":"1983 GMC K2500 Sierra Classic"},
      "clock":{"requested_at":"2026-10-19T11:00:00Z","from":"2026-10-21T16:00:00+00:00","until":"2026-10-21T19:00:00+00:00"},
      "summary":{"asset":{"asset_id":"\(liftA)","kind":"lift","label":"Lift A","capacity":1},
                 "organization":{"kind":"organization","organization_id":"\(orgId)","name":"Fixture Garage"},
                 "requester_role":"customer","requested_by":{"kind":"user","handle":"fixture_customer"},
                 "terms":{"basis":"hourly","amount":40,"currency":"USD"},"capacity_free":true},
      "sign":{"rpc":"confirm_facility_reservation","args_hint":{"p_reservation_id":"\(reservationId)","p_hash":"\(hash)"},
              "binds":["one capacity slot of this asset for the window","your organization's facility offer on the job's facility requirement"],
              "does_not_bind":["payment","vehicle access","other windows"]}}],
     "coverage":{"returned":1,"kinds":["facility_reservation_to_confirm"]}}
    """

    static let reserved = """
    {"reservation_id":"\(reservationId)","reservation_hash":"\(hash)","work_order_id":"\(workOrderId)","asset_id":"\(liftA)",
     "organization_id":"\(orgId)","requirement_id":"rf1","window":{"from":"2026-10-21T16:00:00+00:00","until":"2026-10-21T19:00:00+00:00"},
     "terms":{"basis":"hourly","amount":40,"currency":"USD"},"requester_role":"customer","state":"requested","capacity_free_now":true,
     "duplicate":false,"payment_authorized":false}
    """
}
#endif
