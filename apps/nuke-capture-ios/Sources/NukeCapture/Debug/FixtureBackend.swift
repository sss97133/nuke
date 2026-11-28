// FixtureBackend.swift — a deterministic in-process backend for UI tests. DEBUG-only; never compiled into Release.
//
// Launched with `-NukeFixtureBackend 1` (plus `-NukeFixturePersona visitor|client|provider` and the environment
// NUKE_FIXTURE_SCENARIO), SupabaseService builds its client against https://fixture.nuke.invalid with a URLSession
// whose only protocol is FixtureURLProtocol and an in-memory auth store, so no request can reach production.
// Readers answer from the reader-shaped fixtures the unit tests use; writers answer with receipt-shaped JSON and are
// recorded (RPC name + arguments) for the UI tests, which read them from the `fixture.writes` accessibility element.

#if DEBUG
import Foundation
import Supabase
import SwiftUI

enum FixtureBackend {
    enum Persona: String { case visitor, client, provider }

    static let isActive = UserDefaults.standard.string(forKey: "NukeFixtureBackend") == "1"
    static let persona = Persona(rawValue: UserDefaults.standard.string(forKey: "NukeFixturePersona") ?? "") ?? .visitor
    static let scenario = ProcessInfo.processInfo.environment["NUKE_FIXTURE_SCENARIO"] ?? ""
    static let baseURL = URL(string: "https://fixture.nuke.invalid")!

    static let clientId = "00000000-0000-4000-8000-0000000000d1"
    static let providerId = "00000000-0000-4000-8000-0000000000d2"
    static let navigationVehicleId = "00000000-0000-4000-8000-00000000c001"
    static let laborPhotoId = "00000000-0000-4000-8000-00000000e101"
    static let analysisMode = ProcessInfo.processInfo.environment["NUKE_FIXTURE_ANALYSIS_MODE"] ?? ""
    private static let analysisReadLock = NSLock()
    private static var analysisReadAttempts = 0
    static let dayMode = ProcessInfo.processInfo.environment["NUKE_FIXTURE_DAY_MODE"] ?? ""
    static let journeyDay: String = {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(secondsFromGMT: 0)
        return f.string(from: Date())
    }()
    private static let dayReadLock = NSLock()
    private static var dayReadAttempts = 0
    private static func dayPhotos() -> (Int, Data) {
        dayReadLock.lock()
        dayReadAttempts += 1
        let attempt = dayReadAttempts
        dayReadLock.unlock()
        // Exercise the screen's explicit Retry, independently of the SDK's
        // automatic 503 retry layers. This first read is a terminal response.
        if dayMode == "failure", attempt == 1 {
            return (400, Data(#"{"code":"fixture_read_error","message":"fixture day photo read failed","details":null,"hint":null}"#.utf8))
        }
        if dayMode == "empty" || dayMode == "events" { return ok("[]") }
        if dayMode == "changed", attempt > 1 { return ok("[]") }
        return ok("""
        [{"id":"00000000-0000-4000-8000-00000000e001","image_url":null,
          "taken_at":"\(journeyDay)T12:00:00Z","labels":[],"ai_processing_status":"pending"}]
        """)
    }
    private static let workPageLock = NSLock()
    private static var workPageAttempts = 0
    private static let garageSourceLock = NSLock()
    private static var garageSourceAttempts = 0

    private static func garageCorrections(_ args: [String: Any]) -> (Int, Data) {
        // The detail read names its account explicitly. The list read still sees the original row so the
        // test can exercise withdrawal and a failed recheck after the user selects that exact statement.
        guard args["p_user_id"] != nil else { return ok(GarageCardFixtures.corrections) }
        garageSourceLock.lock()
        garageSourceAttempts += 1
        let attempt = garageSourceAttempts
        garageSourceLock.unlock()
        switch ProcessInfo.processInfo.environment["NUKE_FIXTURE_GARAGE_SOURCE"] {
        case "withdrawn": return ok("[]")
        case "withdrawn_on_return" where attempt > 1: return ok("[]")
        case "failure" where attempt == 1:
            return (400, Data(#"{"code":"fixture_read_error","message":"fixture statement read failed","details":null,"hint":null}"#.utf8))
        default: return ok(GarageCardFixtures.corrections)
        }
    }
    static var userId: String? {
        switch persona {
        case .visitor: return nil
        case .client: return clientId
        case .provider: return providerId
        }
    }

    /// Values planted in reader output that must never reach a visitor's screen.
    static let plantedEmail = "planted.person@example.com"
    static let plantedPhone = "702-555-0199"
    static let plantedAmount = 4321.09

    static let session: URLSession = {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.protocolClasses = [FixtureURLProtocol.self]
        return URLSession(configuration: cfg)
    }()

    static var clientOptions: SupabaseClientOptions {
        SupabaseClientOptions(auth: .init(storage: FixtureAuthStorage(), autoRefreshToken: false, emitLocalSessionAsInitialSession: true),
                              global: .init(session: session))
    }

    // MARK: Writer log

    static let log = FixtureWriteLog()

    /// Readers the app may call: these, plus any *_read, get_* or my_* RPC. Any other RPC is a writer and recorded.
    static let readers: Set<String> = [
        "accounting_vehicle_financials", "accounting_record_evidence",
        "work_order_job_path_read", "work_order_resources_read", "work_order_quotes_read", "work_order_offers_read",
        "work_order_inspection_read", "work_order_invoices_read", "job_evidence_candidates_read",
        "work_order_facility_reservations_read", "work_order_operations_read", "vehicle_work_orders_read",
        "listing_work_plan_read", "open_requirements_read", "provider_profile_read", "provider_job_record_read",
        "compute_vehicle_investment_proof", "vehicle_testimony_summary", "resolve_vehicle_identity_marks",
        "my_contact_requests", "contact_thread_read", "my_signature_queue", "my_work_orders", "my_identity_read",
        "work_order_statement_read", "facility_read", "my_vouches_read", "user_org_relations",
        // The vehicle screen's Comment summary section: a stable read-only SQL function, never a write.
        "popup_vehicle_intel",
        // Versioned STABLE profile readers (20261116050000_profile_read_functions_v1.sql).
        // Their _v1 suffix does not match the generic _read classifier.
        "profile_vehicle_relationships_read_v1", "profile_labor_read_v1", "profile_money_read_v1",
        // A vehicle's log book (20261120100000_vehicle_bound_statements.sql): a STABLE reader.
        "vehicle_statements",
        // The labor appraisal by segment (VehicleLaborAppraisalSection): a STABLE reader.
        "vehicle_labor_appraisal",
    ]

    /// Explore's anonymous market reads. Explore is the default tab, so they run in every launch that
    /// reaches the tab bar; they must never show up as writes.
    static func isMarketRead(_ name: String) -> Bool {
        name.hasPrefix("market_") || name.hasPrefix("treemap_") || name.hasPrefix("map_zip_")
            || ["classified_ask_board", "live_finish_estimates", "price_histogram", "vehicles_by_filters",
                "bat_listing_cohort", "bat_market_baseline", "bat_seller_profile"].contains(name)
    }

    static func isReader(_ name: String) -> Bool {
        readers.contains(name) || name.hasSuffix("_read") || name.hasPrefix("get_") || name.hasPrefix("my_")
    }

    static func respond(_ request: URLRequest) -> (Int, Data) {
        guard let url = request.url, url.host == baseURL.host else { return (404, Data()) }
        let path = url.path
        if scenario == "navigation-garage", !dayMode.isEmpty,
           path == "/rest/v1/vehicle_images" || path == "/rest/v1/vehicle_images_public" {
            let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            if items.contains(where: { $0.name == "taken_at" && $0.value == "gte.\(journeyDay)" }),
               items.contains(where: { $0.name == "taken_at" && ($0.value?.hasPrefix("lt.") ?? false) }) {
                return dayPhotos()
            }
        }
        if scenario == "garage-cards", path == "/rest/v1/vehicle_images" {
            // Only the owned car has a reel; the query names its vehicle.
            let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let owned = items.contains { $0.name == "vehicle_id" && $0.value == "eq.\(GarageCardFixtures.owned)" }
            return ok(owned ? GarageCardFixtures.reel() : "[]")
        }
        if scenario == "navigation-garage", ProcessInfo.processInfo.environment["NUKE_FIXTURE_LABOR_STATE"] == "photos",
           path == "/rest/v1/vehicle_images" || path == "/rest/v1/vehicle_images_public" {
            let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            if items.contains(where: { $0.name == "id" && $0.value == "eq.\(laborPhotoId)" }) {
                guard items.contains(where: { $0.name == "vehicle_id" && $0.value == "eq.\(navigationVehicleId)" }),
                      items.contains(where: { $0.name == "vehicle_image_gallery_eligible" && $0.value == "eq.true" }) else {
                    return (400, Data(#"{"message":"source photo needs vehicle and gallery gates"}"#.utf8))
                }
                if ProcessInfo.processInfo.environment["NUKE_FIXTURE_LABOR_PHOTO"] == "withdrawn" { return ok("[]") }
                return ok("""
                [{"id":"\(laborPhotoId)","image_url":"https://fixture.nuke.invalid/photo.png",
                  "thumbnail_url":null,"is_primary":false,"taken_at":"2026-11-25T12:00:00Z",
                  "labels":[],"ai_processing_status":"completed","image_category":"interior",
                  "created_at":null,"vision_gate_agent_reasoning":null}]
                """)
            }
        }
        if scenario == "navigation-actors", path == "/functions/v1/universal-search" {
            return ok("""
            {"success":true,"results":[{"id":"\(clientId)","type":"user","title":"Fixture Person"}],
             "meta":{"total_count":0,"returned_count":0,"offset":0,"has_more":false,"vehicle_source":"search_vehicles_fts"}}
            """)
        }
        if scenario == "source-inspection", path == "/functions/v1/check-image-vehicle-match" {
            return ok("""
            {"photos":[{"id":"00000000-0000-4000-8000-00000000e001","grain":"source_photo","identity":null,"grouping_asserted":false,
              "source_state":"ready","source_reason":null,"image_url":"https://fixture.nuke.invalid/photo.png","source_sha256":"\(String(repeating: "a", count: 64))",
              "created_at":"2026-10-31T12:00:00Z","taken_at":"2026-10-31T11:00:00Z","attached_vehicle_id_context":null,
              "subject_analysis_state":"current_readings","membership_state":"unfiled",
              "reading_context_coverage":{"grain":"terminal_reading_heads","assessed":1,"qualified":1,"withdrawn":0,"unqualified_or_conflicting":0,"complete":true},
              "readings":[{"id":"00000000-0000-4000-8000-00000000e002","input_key":"fixture","provider":"fixture","model":"source-test",
                "read_at":"2026-10-31T12:00:00Z","observed_at":"2026-10-31T11:00:00Z",
                "input":{"source_sha256":"\(String(repeating: "a", count: 64))","input_sha256":"\(String(repeating: "a", count: 64))","representation":"source"},
                "frame":{"medium":"photograph","primary_subject":"vehicle","view":"detail","bbox":null},
                "unresolved_reasons":["Vehicle identity remains unresolved."]}]}],
             "coverage":{"grain":"owner_source_page","assessed":1,"returned":1,"displayable":1,"without_displayable_pixels":0,"ambiguous_source_rows":0,
               "as_of":"2026-10-31T12:00:00Z","truncated":false,"account_total":null,"accessible_device_library_total":null,"inference_started":false},"next_cursor":null}
            """)
        }
        if path.hasPrefix("/rest/v1/rpc/") {
            let name = String(path.dropFirst("/rest/v1/rpc/".count))
            let args = (FixtureURLProtocol.body(of: request)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
            if scenario == "garage-cards", name == "get_my_garage_owner_corrections", args["p_user_id"] != nil {
                let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
                guard items.contains(where: { $0.name == "id" && $0.value == "eq.00000000-0000-4000-8000-00000000d301" }) else {
                    return (400, Data(#"{"code":"fixture_read_error","message":"statement id filter missing","details":null,"hint":null}"#.utf8))
                }
            }
            if !isReader(name) {
                // Public market reads (Explore's feed, map and terminal) are not writes: answer as
                // before but keep them out of the write log the UI tests assert on.
                if !isMarketRead(name) { log.record(rpc: name, args: args) }
                return writer(name, args)
            }
            return reader(name, args)
        }
        if path.hasPrefix("/rest/v1/") {
            let name = String(path.dropFirst("/rest/v1/".count))
            let method = (request.httpMethod ?? "GET").uppercased()
            if method != "GET" && method != "HEAD" {
                // Row writes (inserts and updates under owner policies) are writers too.
                let body = FixtureURLProtocol.body(of: request).flatMap { try? JSONSerialization.jsonObject(with: $0) }
                let row = (body as? [String: Any]) ?? (body as? [[String: Any]])?.first ?? [:]
                log.record(rpc: "\(method == "PATCH" ? "update" : "insert") \(name)", args: row)
                return (201, Data("[]".utf8))
            }
            return table(name)
        }
        return (404, Data(#"{"message":"not served by the fixture backend"}"#.utf8))
    }

    private static func ok(_ json: String) -> (Int, Data) { (200, Data(json.utf8)) }
    private static let pending = (404, Data(#"{"code":"PGRST202","message":"Could not find the function in the schema cache"}"#.utf8))

    // MARK: Readers

    private static func reader(_ name: String, _ args: [String: Any]) -> (Int, Data) {
        let signedIn = persona != .visitor
        switch name {
        case "get_image_deep_analysis" where scenario == "navigation-garage" && !analysisMode.isEmpty:
            guard args["p_image_id"] as? String == "00000000-0000-4000-8000-00000000e001" else {
                return (400, Data(#"{"message":"wrong fixture image requested"}"#.utf8))
            }
            analysisReadLock.lock()
            analysisReadAttempts += 1
            let attempt = analysisReadAttempts
            analysisReadLock.unlock()
            if analysisMode == "failure", attempt == 1 {
                return (400, Data(#"{"code":"fixture_read_error","message":"fixture analysis read failed","details":null,"hint":null}"#.utf8))
            }
            if analysisMode == "empty" { return ok("[]") }
            return ok(#"[{"narrative":"Fixture analysis for exact photo"}]"#)
        case "get_vehicle_contribution_days" where scenario == "navigation-garage" && !dayMode.isEmpty:
            // A separate work day keeps the timeline available for the event-only day.
            return ok("""
            [{"day":"\(journeyDay)","kind":"\(dayMode == "events" ? "event" : "photo")","n":2},
             {"day":"2026-11-14","kind":"work","n":1}]
            """)
        case "accounting_vehicle_financials" where scenario == "financial-qualification" || scenario == "financial-evidence-withheld":
            return ok("[\(AllocationEvidenceFixtures.row)]")
        case "accounting_record_evidence" where scenario == "financial-qualification" || scenario == "financial-evidence-withheld":
            if ProcessInfo.processInfo.environment["NUKE_FIXTURE_ALLOCATION_SOURCE_WITHHELD"] == "1" { return ok("null") }
            let requestedDocument = (args["p_document_id"] as? String).flatMap(UUID.init(uuidString:))
            return ok(AllocationEvidenceFixtures.source(bank: requestedDocument == UUID(uuidString: AllocationEvidenceFixtures.bank)))
        case "get_vehicle_investment_timeline" where scenario.hasPrefix("financial-"):
            return ok(InvestmentEvidenceFixtures.timeline)
        case "get_vehicle_valuation" where scenario == "financial-qualification":
            return ok(InvestmentEvidenceFixtures.valuation)
        case "compute_vehicle_investment_proof" where scenario == "financial-qualification":
            return ok(InvestmentEvidenceFixtures.proof)
        case "compute_vehicle_investment_proof" where scenario == "financial-evidence-withheld":
            return ok(InvestmentEvidenceFixtures.withheld)
        case "compute_vehicle_investment_proof" where scenario.hasPrefix("receipt-"):
            return ok(ReceiptDepthFixtures.proof)
        case "get_vehicle_day_documents" where scenario.hasPrefix("receipt-") || scenario == "financial-qualification":
            return ok(scenario == "receipt-withdrawn" ? ReceiptDepthFixtures.withdrawn : ReceiptDepthFixtures.day)
        case "get_vehicle_receipt_work_context" where scenario.hasPrefix("receipt-"):
            return ok(ReceiptDepthFixtures.work)
        case "get_orphan_sessions" where scenario == "source-inspection":
            return ok("""
            [{"session_day":"2026-10-31","gps_cell":"fixture","photo_count":1,"image_ids":["00000000-0000-4000-8000-00000000e001"],"sample_url":null,"suggested_vehicle_id":null,"suggested_vehicle_label":null}]
            """)
        case "get_user_garage" where scenario == "garage-cards": return ok(GarageCardFixtures.garage())
        case "get_my_garage_owner_corrections" where scenario == "garage-cards": return garageCorrections(args)
        case "my_unorganized_photo_count" where scenario == "garage-cards": return ok("37")
        case "get_vehicle_contribution_days_batch":
            // The garage cards' day reader: rows for the cards scenario, a successful empty answer elsewhere.
            return ok(scenario == "garage-cards" ? GarageCardFixtures.timelines() : "[]")
        case "vehicle_profile_read" where scenario == "garage-cards":
            return ok(GarageCardFixtures.profileRead(args["p_vehicle_id"] as? String ?? ""))
        case "vehicle_statements" where scenario == "garage-cards": return ok(GarageCardFixtures.statements)
        case "vehicle_statements": return ok("null")
        case "vehicle_labor_appraisal" where scenario == "navigation-garage" && ProcessInfo.processInfo.environment["NUKE_FIXTURE_LABOR_STATE"] == "pending":
            return ok(#"{"status":"not_yet_computed","segments":[],"state":{"fresh":false,"computed":false,"error":null}}"#)
        case "vehicle_labor_appraisal" where scenario == "navigation-garage" && ProcessInfo.processInfo.environment["NUKE_FIXTURE_LABOR_STATE"] == "stale":
            return ok(#"{"applicable":true,"as_of":"2026-11-25T12:00:00Z","segments":[{"segment":"engine","hours_min":8,"hours_typical":12,"hours_max":16}],"state":{"fresh":false,"computed":true,"computed_at":"2026-11-25T12:00:00Z","error":null}}"#)
        case "vehicle_labor_appraisal" where scenario == "navigation-garage" && ProcessInfo.processInfo.environment["NUKE_FIXTURE_LABOR_STATE"] == "photos":
            return ok("""
            {"vehicle_id":"\(navigationVehicleId)","applicable":true,"as_of":"2026-11-25T12:00:00Z",
             "state":{"fresh":true,"computed":true},"totals":{"priced_segments":1},
             "segments":[{"segment":"reassembly","hours_min":2,"hours_typical":2,"hours_max":2,
               "reassembly":{"matched":[{"image_id":"\(laborPhotoId)","part":{"name":"Fixture carpet"},"hours":2}],
                             "unmatched":[{"part":{"name":"No photo returned"}}]}}]}
            """)
        case "vehicle_labor_appraisal": return ok("null")
        case "vehicle_profile_read" where ["navigation-garage", "source-inspection", "receipt-depth", "receipt-withdrawn", "financial-qualification", "financial-evidence-withheld"].contains(scenario):
            return ok("""
            {"vehicle_id":"\(navigationVehicleId)","viewer":"\((scenario.hasPrefix("receipt-") || scenario.hasPrefix("financial-")) ? "owner" : "anon")","read_at":"2026-10-31T12:00:00Z",
             "sections":[\(scenario == "financial-qualification" ? InvestmentEvidenceFixtures.mastheadSection : ""){"kind":"strip","coverage":{"n":1,"of":1,"grain":"source claims","as_of":"2026-10-31T12:00:00Z"},
               "facets":[{"dimension":"engine","label":"350 V8 Crate","member":{"value":"350 V8 Crate",
                 "source":{"kind":"listing","label":"Dealer seller listing","method":"dealer_microdata_v2","url":"https://example.com/vehicle"},
                 "trust":0.6,"qualification":{"role":"seller_claim","factory_configuration_status":"unknown","current_configuration_status":"unknown"}}}]}]}
            """)
        case "get_user_garage" where ["navigation-garage", "source-inspection", "receipt-depth", "receipt-withdrawn", "financial-qualification", "financial-evidence-withheld"].contains(scenario):
            return ok("""
            [{"vehicle_id":"\(navigationVehicleId)","year":1973,"make":"Fixture","model":"Coupe",
              "trim_name":null,"image_url":null,"current_value":null,"image_count":0,"relationship":"profile_record"}]
            """)
        case "get_my_garage_owner_corrections" where ["navigation-garage", "source-inspection", "receipt-depth", "receipt-withdrawn", "financial-qualification", "financial-evidence-withheld"].contains(scenario): return ok("[]")
        case "my_unorganized_photo_count" where ["navigation-garage", "source-inspection", "receipt-depth", "receipt-withdrawn", "financial-qualification", "financial-evidence-withheld"].contains(scenario): return ok("0")
        case "listing_work_plan_read": return ok(PlanFixtures.plan)
        case "my_suggested_provider_links": return ok(ParityFixtures.suggestions)
        case "work_order_publication_read":
            return scenario == "publish" ? ok(ParityFixtures.publication(visibility: "not_published")) : pending
        case "organization_supply_read": return ok(ParityFixtures.supply)
        case "facility_read": return scenario == "org" ? ok(FacilityFixtures.read(party: false)) : pending
        case "get_org_page":
            return ok(#"{"org":{"id":"\#(ParityFixtures.orgId)","name":"Fixture Garage","type":"garage","city":"Fixture City","state":"NV"},"as_of":"2026-10-19T20:00:00Z","half_life_hours":6,"dormant_below":0.05,"basis":[],"you":null,"vehicles":[],"vehicles_considered":0,"vehicles_total":0}"#)
        case "vehicle_work_orders_read":
            let access = scenario == "post-job" ? #""vehicle_access":{"role":"owner","can_post_work_request":true},"# : ""
            return ok(JobFixtures.vehicleWorkOrders.replacingOccurrences(of: #""viewer":{"#, with: #""viewer":{\#(access)"#))
        case "work_order_job_path_read" where scenario == "work-pagination":
            guard args["p_work_order_id"] as? String == JobFixtures.workOrderId else {
                return (400, Data(#"{"message":"wrong active job"}"#.utf8))
            }
            return ok(JobFixtures.jobPathWithLabels)
        case "work_order_job_path_read": return ok(jobPath(args["p_work_order_id"] as? String ?? ""))
        case "work_order_resources_read": return ok(JobFixtures.resources)
        case "work_order_quotes_read":
            switch scenario {
            case "post-job": return ok(JobFixtures.quotesForCustomer)
            case "privacy-job": return ok(JobFixtures.quotesAcceptedForVisitor)
            default: return ok(JobFixtures.quotesNone)
            }
        case "work_order_offers_read":
            switch scenario {
            case "offer": return ok(providerOffers)
            case "cosign": return ok(CosignFixtures.offers(customer: true))
            default: return ok(#"{"requirements":[],"accepted_providers":[],"viewer":{"context":"visitor","slots":[],"actions":[]}}"#)
            }
        case "work_order_invoices_read":
            if scenario == "provider-start" { return ok(CloseoutFixtures.invoices(party: true, asPayer: false)) }
            if scenario == "privacy-job" { return ok(CloseoutFixtures.invoices(party: false)) }
            return pending
        case "job_evidence_candidates_read": return signedIn ? ok(CloseoutFixtures.evidence) : pending
        case "work_order_facility_reservations_read":
            return ok(#"{"reservations":[],"viewer":{"party":false,"actions":[]},"payment_authorized":false}"#)
        case "work_order_operations_read": return ok(IssueQuoteFixtures.operationsRead)
        case "open_requirements_read":
            return ["offer", "publish"].contains(scenario) ? ok(ParityFixtures.openWithPlanB(signedIn: signedIn)) : ok(OfferFixtures.open(signedIn: signedIn))
        case "provider_profile_read":
            if scenario == "setup" { return ok(ParityFixtures.selfProfile) }
            var p = ProviderFixtures.profile(context: signedIn ? "visitor" : "visitor")
            if scenario == "contact-send" {
                p = p.replacingOccurrences(of: #""contact":{"action":"contact_via_nuke","available":false,"basis":"contact between users is brokered by Nuke"}"#,
                                           with: #""contact":\#(ContactFixtures.availableBlock)"#)
            }
            if scenario == "privacy-profile" {
                p = p.replacingOccurrences(of: #""profession":"restoration""#,
                                           with: #""profession":"restoration","email":"\#(plantedEmail)","phone":"\#(plantedPhone)""#)
                p = p.replacingOccurrences(of: #""city":"Fixture City","state":"NV","#,
                                           with: #""city":"Fixture City","state":"NV","address":"1 Planted Street","full_name":"Planted Person","#)
            }
            return ok(p)
        case "provider_job_record_read": return ok(ProviderFixtures.jobRecord)
        case "my_contact_requests": return ok(ContactFixtures.inbox)
        case "contact_thread_read": return ok(ContactFixtures.thread)
        case "my_signature_queue" where scenario == "signature-missing-job":
            return ok(#"{"items":[{"kind":"quote_to_accept","ref_id":"00000000-0000-4000-8000-0000000000f2","work_order_id":null,"display_title":"Fixture quote without job"}],"coverage":{"returned":1,"total":1}}"#)
        case "my_signature_queue" where scenario == "work-pagination":
            return ok(#"{"items":[],"coverage":{"returned":0,"total":0}}"#)
        case "my_work_orders" where scenario == "work-pagination":
            let cursor = "00000000-0000-4000-8000-00000000d025"
            if let after = args["p_after"] as? String {
                guard after == cursor else { return (400, Data(#"{"message":"wrong page cursor"}"#.utf8)) }
                workPageLock.lock()
                workPageAttempts += 1
                let attempt = workPageAttempts
                workPageLock.unlock()
                if attempt == 1 {
                    return (400, Data(#"{"code":"fixture_read_error","message":"fixture next page failed","details":null,"hint":null}"#.utf8))
                }
                return ok("""
                {"rows":[{"work_order_id":"\(JobFixtures.workOrderId)","title":"Front brake service\(attempt > 2 ? " · refreshed" : "")",
                 "stage_states":{"execution":"recorded","completion":"absent"}}],"next_after":null,
                 "coverage":{"returned":1,"total_for_viewer":26}}
                """)
            }
            let rows = (1...25).map { index in
                ["work_order_id": String(format: "00000000-0000-4000-8000-00000000d%03d", index),
                 "title": "Finished fixture job \(index)", "stage_states": ["completion": "recorded", "accounting": "recorded"]] as [String: Any]
            }
            let page: [String: Any] = ["rows": rows, "next_after": cursor, "coverage": ["returned": 25, "total_for_viewer": 26]]
            return (200, try! JSONSerialization.data(withJSONObject: page))
        case "my_signature_queue": return ok(JobFixtures.signatureQueue)
        case "my_work_orders": return ok(JobFixtures.myWorkOrders)
        case "my_identity_read": return ok(JobFixtures.identity)
        case "work_order_statement_read":
            return ok(JobFixtures.statementVisitor
                .replacingOccurrences(of: #""payments":null,"balance":null"#, with: #""payments":\#(plantedAmount),"balance":\#(plantedAmount)"#)
                .replacingOccurrences(of: #""payments_total":null,"balance_due":null"#, with: #""payments_total":\#(plantedAmount),"balance_due":\#(plantedAmount)"#))
        default: return pending
        }
    }

    /// The provider's view of the open job: offer on the tool requirement, nothing to accept.
    private static var providerOffers: String {
        OfferFixtures.offersView(provider: true).replacingOccurrences(
            of: #"[{"action":"withdraw_offer","rpc":"withdraw_offer","args":{"p_offer_id":"\#(OfferFixtures.offerId)"}}]"#,
            with: #"[{"action":"offer","rpc":"offer_on_requirement","args":{"p_requirement_id":"\#(OfferFixtures.reqTool)"},"as":{"offer_kind":"individual","offer_rung":"self_claim"}}]"#)
    }

    private static func jobPath(_ id: String) -> String {
        switch scenario {
        case "provider-start":
            // The accepted technician before starting, with a readable scope hash so Mark the work done is offered.
            return PostJobFixtures.beforeStart.replacingOccurrences(
                of: #""completion":\{[^{}]*\}"#, with: #""completion":\#(CloseoutFixtures.completionStage(attested: false, accepted: false))"#,
                options: .regularExpression)
        case "privacy-job":
            return JobFixtures.jobPathWithLabels
                .replacingOccurrences(of: #""context":"client","slots":["customer"]"#, with: #""context":"visitor","slots":[]"#)
                .replacingOccurrences(of: #""intake":{"state":"recorded","#,
                                      with: #""intake":{"state":"recorded","customer_email":"\#(plantedEmail)","customer_phone":"\#(plantedPhone)","customer_full_name":"Planted Person","#)
                .replacingOccurrences(of: #""accounting":{"state":"absent","#,
                                      with: #""accounting":{"state":"partial","payment_amount":\#(plantedAmount),"balance_due":\#(plantedAmount),"#)
        default:
            return JobFixtures.jobPathWithLabels.replacingOccurrences(of: JobFixtures.workOrderId, with: id.isEmpty ? JobFixtures.workOrderId : id)
        }
    }

    // MARK: Writers (receipt-shaped answers)

    private static func writer(_ name: String, _ args: [String: Any]) -> (Int, Data) {
        switch name {
        case "confirm_work_session" where scenario == "financial-qualification":
            let id = (args["p_session_id"] as? String ?? "").lowercased()
            if id.hasSuffix("f004") { return ok(#"{"ok":false,"error":"not_authorized"}"#) }
            if id.hasSuffix("f005") { return ok("{}") }
            if id.hasSuffix("f006") { return ok(#"{"ok":"#) }
            if id.hasSuffix("f007") { return (-1, Data()) } // finite transport failure below
            return ok(#"{"ok":true,"session_id":"\#(id)","confirmed":true}"#)
        case "post_work_request": return ok(PostJobFixtures.posted)
        case "accept_work_order_quote": return ok(JobFixtures.acceptReceipt)
        case "offer_on_requirement": return ok(OfferFixtures.offerReceipt)
        case "accept_offer": return ok(#"{"accepted":true,"payment_authorized":false}"#)
        case "start_work":
            return ok(#"{"start_id":"s1","work_order_id":"\#(args["p_work_order_id"] as? String ?? "")","started_at":"2026-10-21T16:00:00Z","duplicate":false,"payment_authorized":false}"#)
        case "attest_work_completion":
            return ok(#"{"completion_id":"\#(CloseoutFixtures.completionId)","completion_hash":"\#(CloseoutFixtures.completionHash)","duplicate":false,"payment_authorized":false}"#)
        case "request_contact": return ok(ContactFixtures.sendReceipt)
        case "respond_contact_request": return ok(#"{"request_id":"\#(args["p_id"] as? String ?? "")","status":"accepted"}"#)
        case "post_contact_message": return ok(#"{"message_id":"m3","created_at":"2026-10-19T09:10:00Z"}"#)
        case "publish_work_order":
            return ok(#"{"work_order_id":"\#(args["p_work_order_id"] as? String ?? "")","visibility":"\#(args["p_visibility"] as? String ?? "")","providers_notified":false,"payment_authorized":false}"#)
        case "claim_organization": return ok(ParityFixtures.claimed)
        case "create_supplier_invite": return ok(ParityFixtures.invite)
        default: return ok("{}")
        }
    }

    // MARK: Tables (PostgREST selects)

    private static func table(_ name: String) -> (Int, Data) {
        switch name {
        case "vehicle_timeline_events" where scenario == "financial-qualification":
            return ok(InvestmentEvidenceFixtures.saleEvents)
        case "receipt_vehicle_links" where scenario.hasPrefix("receipt-") || scenario == "financial-qualification":
            return ok(ReceiptDepthFixtures.links)
        case "vehicles" where scenario == "garage-cards": return ok(GarageCardFixtures.metadata)
        case "vehicle_images" where scenario == "garage-cards": return ok("[]")
        case "vehicles" where ["navigation-garage", "source-inspection", "receipt-depth", "receipt-withdrawn", "financial-qualification", "financial-evidence-withheld"].contains(scenario):
            return ok("""
            [{"id":"\(navigationVehicleId)","year":1973,"make":"Fixture","model":"Coupe","vin":"TEST1234567",
              "trim":null,"primary_image_url":null,"image_count":0}]
            """)
        case "vehicle_images" where scenario == "source-inspection":
            return ok(#"[{"id":"00000000-0000-4000-8000-00000000e001","image_url":"https://fixture.nuke.invalid/photo.png","auto_suggested_vehicle_id":null,"auto_suggestion_reasons":null}]"#)
        case "vehicle_images" where scenario == "navigation-garage": return ok("[]")
        case "vehicle_images_public" where ["navigation-garage", "source-inspection", "receipt-depth", "receipt-withdrawn", "financial-qualification", "financial-evidence-withheld"].contains(scenario): return ok("[]")
        case "vehicle_images": return ok(persona == .client ? PostJobFixtures.photos : "[]")
        case "profiles": return ok(ParityFixtures.ownRow)
        case "tool_requirement_key_map": return ok(ParityFixtures.toolKeys)
        default: return ok("[]")
        }
    }
}

/// Every request on the fixture session lands here; nothing is forwarded.
final class FixtureURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    static func body(of request: URLRequest) -> Data? {
        if let b = request.httpBody { return b }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let n = stream.read(&buffer, maxLength: buffer.count)
            if n <= 0 { break }
            data.append(buffer, count: n)
        }
        return data
    }

    override func startLoading() {
        let (status, data) = FixtureBackend.respond(request)
        if status == -1 {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        let response = HTTPURLResponse(url: request.url ?? FixtureBackend.baseURL, statusCode: status, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

/// No Keychain in fixture runs: the session lives and dies with the process.
final class FixtureAuthStorage: AuthLocalStorage, @unchecked Sendable {
    private var store: [String: Data] = [:]
    private let lock = NSLock()
    func store(key: String, value: Data) throws { lock.lock(); store[key] = value; lock.unlock() }
    func retrieve(key: String) throws -> Data? { lock.lock(); defer { lock.unlock() }; return store[key] }
    func remove(key: String) throws { lock.lock(); store[key] = nil; lock.unlock() }
}

/// Writer calls in order, as JSON lines, observable by the overlay the UI tests read.
final class FixtureWriteLog: ObservableObject, @unchecked Sendable {
    @MainActor @Published private(set) var text = ""
    private let lock = NSLock()
    private var lines: [String] = []

    func record(rpc: String, args: [String: Any]) {
        let entry: [String: Any] = ["rpc": rpc, "args": args]
        guard let data = try? JSONSerialization.data(withJSONObject: entry, options: [.sortedKeys]),
              let line = String(data: data, encoding: .utf8) else { return }
        lock.lock(); lines.append(line); let joined = lines.joined(separator: "\n"); lock.unlock()
        Task { @MainActor in self.text = joined }
    }
}

/// A one-point element carrying the writer log; invisible, but in the accessibility tree.
struct FixtureWriteLogOverlay: View {
    @ObservedObject var log = FixtureBackend.log

    var body: some View {
        Text(" ")
            .font(.system(size: 1))
            .frame(width: 1, height: 1)
            .accessibilityElement()
            .accessibilityLabel(log.text.isEmpty ? "no writes" : log.text)
            .accessibilityIdentifier("fixture.writes")
            .allowsHitTesting(false)
    }
}
#endif
