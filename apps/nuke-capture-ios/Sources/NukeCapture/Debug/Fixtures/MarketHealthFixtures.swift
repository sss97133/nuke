// MarketHealthFixtures.swift — job_market_health_read() JSON.
// DEBUG-only (unit tests and the UI-test fixture backend); never compiled into Release. Keys mirror the live read on
// 2026-10-19 (pg_get_functiondef job_market_health_read / job_market_health_compute); the counts are synthetic.

#if DEBUG
enum MarketHealthFixtures {
    private static func day(_ date: String, open: Int, evidenced: Int, backup: Int) -> String {
        """
        {"date":"\(date)","jobs":26,"offers":0,"invoices":0,"quotes_accepted":0,"with_plan_b_any":null,"open_requirements":\(open),
         "payment_witnesses":0,"completions_accepted":0,"with_plan_b_supplier":\(backup),"new_requests_last_7_days":0,
         "with_evidenced_candidate":0,"with_plan_b_listing_only":null,"evidenced_provider_accounts":\(evidenced),"verified_claimant_organizations":0}
        """
    }

    /// The live envelope; `days` daily snapshots (1 = the first day, before any trend line).
    static func read(days: Int = 3, offers: Int = 0) -> String {
        let history = [day("2026-10-17", open: 31, evidenced: 1, backup: 18),
                       day("2026-10-18", open: 35, evidenced: 1, backup: 21),
                       day("2026-10-19", open: 39, evidenced: 1, backup: 23)].suffix(max(days, 0))
        return """
        {"as_of":"2026-10-19T20:00:00+00:00","history_basis":"daily snapshots (UTC), last 90 days; written by cron job-market-health-snapshot",
         "demand":{"jobs":26,"published":{"open":4,"unset":21,"invite_only":1},
                   "new_requests":{"last_7_days":0,"last_30_days":0,"published_open_last_7_days":4,"published_open_last_30_days":4},
                   "jobs_by_stage":{"intake":20,"open":6},"jobs_by_status":{"pending":22,"in_progress":4},
                   "inspection_orders":{"open":0,"total":1},"open_requirements":39,
                   "requirements_by_kind":{"skill":20,"tool":12,"facility":7},"open_requirements_by_kind":{"skill":20,"tool":12,"facility":7}},
         "supply":{"provider_population":1,"providers_with_both":0,"declared_facility_assets":0,"provider_population_capped":false,
                   "verified_claimant_accounts":0,"providers_with_availability":0,"providers_with_service_area":0,
                   "supply_organizations_claimable":{"document_only":2,"by_domain_email":21,"not_on_nuke_yet":23},
                   "verified_claimant_organizations":0,"declared_facility_assets_by_kind":{},"organizations_with_declared_assets":0,
                   "organizations_with_supply_evidence":23,"accounts_with_pending_provider_links":0,"accounts_with_evidenced_provider_links":1},
         "matching":{"open_requirements":39,"with_plan_b_supplier":23,"with_evidenced_candidate":0,"with_no_provider_considered":5,
                     "with_reachable_plan_b_supplier":2,"skill_key_coverage":{},"plan_b_by_tier":{},"unknown_for_all":{}},
         "flow":{"counts":{"offers":\(offers),"starts":0,"invoices":0,"quotes_issued":0,"offers_accepted":0,"quotes_accepted":0,
                           "payment_witnesses":0,"completions_accepted":0,"completions_attested":0,"invoices_with_payment_witness":0},
                 "step_hours":{"offer_to_acceptance":{"samples":0,"median_hours":null}}},
         "history":[\(history.joined(separator: ","))],
         "rules":{},"trust":{"exposure_basis":"x","open_exposures_known":0,"owner_delegated_signs":0,"owner_delegated_signs_last_30_days":0}}
        """
    }
}
#endif
