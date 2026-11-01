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
        "work_order_job_path_read", "work_order_resources_read", "work_order_quotes_read", "work_order_offers_read",
        "work_order_inspection_read", "work_order_invoices_read", "job_evidence_candidates_read",
        "work_order_facility_reservations_read", "work_order_operations_read", "vehicle_work_orders_read",
        "listing_work_plan_read", "open_requirements_read", "provider_profile_read", "provider_job_record_read",
        "my_contact_requests", "contact_thread_read", "my_signature_queue", "my_work_orders", "my_identity_read",
        "work_order_statement_read", "facility_read", "my_vouches_read", "user_org_relations",
    ]

    static func isReader(_ name: String) -> Bool {
        readers.contains(name) || name.hasSuffix("_read") || name.hasPrefix("get_") || name.hasPrefix("my_")
    }

    static func respond(_ request: URLRequest) -> (Int, Data) {
        guard let url = request.url, url.host == baseURL.host else { return (404, Data()) }
        let path = url.path
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
            if !isReader(name) {
                log.record(rpc: name, args: args)
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
        case "get_orphan_sessions" where scenario == "source-inspection":
            return ok("""
            [{"session_day":"2026-10-31","gps_cell":"fixture","photo_count":1,"image_ids":["00000000-0000-4000-8000-00000000e001"],"sample_url":null,"suggested_vehicle_id":null,"suggested_vehicle_label":null}]
            """)
        case "vehicle_profile_read" where ["navigation-garage", "source-inspection"].contains(scenario):
            return ok("""
            {"vehicle_id":"\(navigationVehicleId)","viewer":"anon","read_at":"2026-10-31T12:00:00Z",
             "sections":[{"kind":"strip","coverage":{"n":1,"of":1,"grain":"source claims","as_of":"2026-10-31T12:00:00Z"},
               "facets":[{"dimension":"engine","label":"350 V8 Crate","member":{"value":"350 V8 Crate",
                 "source":{"kind":"listing","label":"Dealer seller listing","method":"dealer_microdata_v2","url":"https://example.com/vehicle"},
                 "trust":0.6,"qualification":{"role":"seller_claim","factory_configuration_status":"unknown","current_configuration_status":"unknown"}}}]}]}
            """)
        case "get_user_garage" where ["navigation-garage", "source-inspection"].contains(scenario):
            return ok("""
            [{"vehicle_id":"\(navigationVehicleId)","year":1973,"make":"Fixture","model":"Coupe",
              "trim_name":null,"image_url":null,"current_value":null,"image_count":0,"relationship":"profile_record"}]
            """)
        case "get_my_garage_owner_corrections" where ["navigation-garage", "source-inspection"].contains(scenario): return ok("[]")
        case "my_unorganized_photo_count" where ["navigation-garage", "source-inspection"].contains(scenario): return ok("0")
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
        case "vehicles" where ["navigation-garage", "source-inspection"].contains(scenario):
            return ok("""
            [{"id":"\(navigationVehicleId)","year":1973,"make":"Fixture","model":"Coupe","vin":"TEST1234567",
              "trim":null,"primary_image_url":null,"image_count":0}]
            """)
        case "vehicle_images" where scenario == "source-inspection":
            return ok(#"[{"id":"00000000-0000-4000-8000-00000000e001","image_url":"https://fixture.nuke.invalid/photo.png","auto_suggested_vehicle_id":null,"auto_suggestion_reasons":null}]"#)
        case "vehicle_images" where scenario == "navigation-garage": return ok("[]")
        case "vehicle_images_public" where ["navigation-garage", "source-inspection"].contains(scenario): return ok("[]")
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
