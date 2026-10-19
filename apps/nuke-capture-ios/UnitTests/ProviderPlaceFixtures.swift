// ProviderPlaceFixtures.swift — work_order_provider_place_read JSON for tests. Test-only; never in the app bundle.
// Shapes captured read-only from production on 2026-10-19 (a temp-schema copy of migration 20261020071500 run
// against two live jobs, as an anonymous visitor) and from its PG17 contract; ids, names, handles and cities
// replaced with synthetic values.

enum ProviderPlaceFixtures {
    static let orgId = "00000000-0000-4000-8000-0000000000a1"
    static let providerId = "00000000-0000-4000-8000-0000000000c1"

    /// A legacy job filed under a personal collection: city-level place, three recorded assignment people with no
    /// account, and a tracker with an estimate, a bare accepted status, a legacy start clock and shop messages.
    static let legacy = """
    {"shop":{"name":"Fixture Collection","hours":{"basis":"no hours on the organization record","state":"not_recorded"},
      "place":{"city":"Reno","basis":"city and state from the public organization record; street address, coordinates and phone are withheld because its entity type (collection) is not established as a storefront business",
        "phone":null,"state":"Nevada","zip_code":null,"precision":"city","directions":false,"storefront":false,
        "clock_basis":"organizations.updated_at: when the record last changed, not when the place was observed","coordinates":null,
        "street_address":null,"record_updated_at":"2026-02-15T21:24:02.931448+00:00"},
      "state":"public","rating":{"basis":"no reviews are recorded for this organization","state":"not_rated"},"logo_url":null,
      "role_basis":"work_orders.organization_id: the organization the work order is filed under; not by itself a claim of who performs the work",
      "entity_type":"collection","role_on_job":"work order organization","business_type":"collection","organization_id":"\(orgId)"},
     "as_of":"2026-10-19T21:05:00.000000+00:00",
     "people":{"basis":"people by public handle or unnamed party; no contact fields; areas are self-claimed city-level bands",
      "accepted_providers":[],
      "recorded_assignments":[
       {"basis":"recorded assignment rows on the work order; not an accepted offer Sign","roles":["helper"],"person":{"kind":"user","label":"unnamed party"},
        "statuses":{"accepted":1},"assignments":1,"service_area":{"basis":"the technician record names no account","state":"not_assessed"}},
       {"basis":"recorded assignment rows on the work order; not an accepted offer Sign","roles":["helper"],"person":{"kind":"user","label":"unnamed party"},
        "statuses":{"accepted":1},"assignments":1,"service_area":{"basis":"the technician record names no account","state":"not_assessed"}},
       {"basis":"recorded assignment rows on the work order; not an accepted offer Sign","roles":["lead"],"person":{"kind":"user","label":"unnamed party"},
        "statuses":{"pending":1,"completed":1,"in_progress":5},"assignments":7,"service_area":{"basis":"the technician record names no account","state":"not_assessed"}}]},
     "work_site":{"basis":"no work location is recorded for this job: work orders carry no location and no facility reservation is confirmed","state":"not_recorded",
      "mobile_service":{"basis":"organizations.offers_mobile_service is a column default, not a statement of shop versus mobile work","state":"not_established",
        "declaration_basis":"self-claimed service areas (set_provider_service_area)","accepted_providers_declaring_mobile":0}},
     "vehicle_place":{"city":"Sparks","basis":"city and state on the vehicle record; no street address or coordinates","state":"NV","precision":"city"},
     "tracker":{"basis":"derived from the job path stages for this viewer (read_work_order_job_path); no estimated times","current_step":"in_progress",
      "steps":[
       {"key":"requested","label":"Requested","state":"reached","evidence":"record","clock":"2026-02-27T17:51:48.608998+00:00","clock_basis":"work order created","basis":"work order record","reports":null,"conflicting":false,"job_path_stage":"intake"},
       {"key":"quoted","label":"Quoted","state":"partial","evidence":"record","basis":"an estimate is recorded without a quote clock","reports":null,"conflicting":false,"job_path_stage":"terms"},
       {"key":"accepted","label":"Accepted","state":"status_only","evidence":"status","basis":"an assignment status says accepted, with no clock behind it",
        "reports":{"claims":3,"by_side":{"client":3},"latest_message_at":"2026-02-24T00:21:07.518+00:00","basis":"attributed retained messages; not Signs, not verified; they never move a step"},"conflicting":true,"job_path_stage":"terms"},
       {"key":"in_progress","label":"In progress","state":"reached","evidence":"record","clock":"2026-02-27T00:00:00+00:00","clock_basis":"start clock on the work order record","basis":"legacy_start_clock_or_component_events",
        "reports":{"claims":1,"by_side":{"provider":1}},"conflicting":false,"job_path_stage":"execution"},
       {"key":"done","label":"Done","state":"not_yet","basis":"no completion recorded","reports":{"claims":3,"by_side":{"provider":3}},"conflicting":true,"job_path_stage":"completion"},
       {"key":"paid","label":"Paid","state":"withheld","basis":"payments and balances between specific parties are shown only to those parties","reports":null,"conflicting":false,"job_path_stage":"accounting"}]},
     "coverage":{"shop":"public","work_site":"not_recorded","tracker_steps":6,"customer_contact":"never_returned","accepted_providers":0,
      "shop_place_precision":"city","recorded_assignment_people":3,"providers_with_service_area":0},
     "viewer":{"party":false,"slots":[],"context":"visitor","decided_from":"auth.uid()","money_visible":false,"contact_visible":false,"identity_bridge":"none"},
     "display_title":"Fixture pre-delivery work","work_order_status":"in_progress","payment_authorized":false}
    """

    /// A storefront shop with a recorded location and phone, one accepted provider with a self-stated band, and a
    /// tracker signed through acceptance.
    static let storefront = """
    {"shop":{"state":"public","organization_id":"\(orgId)","name":"Fixture Garage","logo_url":"https://example.invalid/logo.png",
      "entity_type":"restoration_shop","business_type":"garage",
      "rating":{"state":"not_rated","basis":"no reviews are recorded for this organization"},
      "hours":{"state":"recorded","as_recorded":{"sun":"closed","mon-fri":"8am-5pm"},"basis":"hours as written on the organization record; not verified and not a live open or closed state"},
      "place":{"city":"Reno","state":"NV","zip_code":"89501","street_address":"1 Fixture Way","coordinates":{"latitude":39.52,"longitude":-119.81},
        "precision":"coordinates","storefront":true,"directions":true,"phone":"+1 (555) 019-9000",
        "basis":"public business record (organization is public; entity type restoration_shop is a storefront business)",
        "record_updated_at":"2026-05-23T20:05:23+00:00"},
      "role_on_job":"work order organization"},
     "as_of":"2026-10-19T21:01:31.892492+00:00",
     "people":{"accepted_providers":[
       {"person":{"kind":"user","handle":"fixture_tech","profile_id":"\(providerId)"},"roles":["technician"],"accepted_at":"2026-10-19T21:01:31.789036+00:00",
        "accepted_offers":1,"acceptance_basis":"authenticated_sign: the customer accepted this provider's offer (accept_offer)",
        "service_area":{"state":"declared","claim_basis":"self_claim","city":"Sparks","state_code":"NV","radius_miles":25,"mobile":true,"geocoded":true,
          "place_basis":"city-level band stated by the account; no street address or coordinates"},
        "availability":{"state":"declared","claim_basis":"self_claim","timezone":"America/Los_Angeles",
          "weekly":[{"dow":1,"day":"Mon","start":"08:00","end":"17:00"},{"dow":2,"day":"Tue","start":"08:00","end":"12:00"}],"exceptions_upcoming":[]}}],
      "recorded_assignments":[]},
     "work_site":{"state":"not_recorded","basis":"no work location is recorded for this job"},
     "vehicle_place":{"city":"Reno","state":"NV","precision":"city"},
     "tracker":{"current_step":"accepted","steps":[
       {"key":"requested","label":"Requested","state":"reached","evidence":"record","clock":"2026-01-01T00:00:00+00:00","clock_basis":"work order created","conflicting":false,"reports":null},
       {"key":"quoted","label":"Quoted","state":"reached","evidence":"sign","clock":"2026-10-01T00:00:00+00:00","clock_basis":"current quote","conflicting":false,"reports":null},
       {"key":"accepted","label":"Accepted","state":"reached","evidence":"sign","clock":"2026-10-19T21:01:31.789036+00:00","clock_basis":"offer acceptance","conflicting":false,"reports":null},
       {"key":"in_progress","label":"In progress","state":"not_yet","conflicting":false,"reports":null},
       {"key":"done","label":"Done","state":"not_yet","conflicting":false,"reports":null},
       {"key":"paid","label":"Paid","state":"not_yet","basis":"no invoice or payment recorded","conflicting":false,"reports":null},
       {"label":"step without a key"}]},
     "viewer":{"context":"client","party":true}}
    """
}
