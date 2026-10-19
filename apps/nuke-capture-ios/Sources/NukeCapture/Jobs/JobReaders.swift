// JobReaders.swift — the authenticated job readers, called the way the web calls them.
//
// Every call goes through SupabaseService.client to a server reader (R4 §4 #1–#6). The phone
// adds no query of its own for job state and gates nothing on sign-in: data is open by default,
// so the reader decides who may read. A reader that is not deployed, or that refuses, becomes a
// JobRefusal in plain words ("Not available yet" and why), so a screen shows that instead of
// placeholder rows (C0). The reader name is kept for DEBUG disclosure only.

import Foundation
import Supabase

/// Why a job reader returned nothing to show.
struct JobRefusal: Error, Equatable {
    enum Kind: Equatable {
        case readerPending   // the RPC is not deployed (PostgREST PGRST202 / 42883 / HTTP 404)
        case signInNeeded    // the reader answers signed-in accounts only ('Sign-in required', 42501)
        case unavailable     // 'Work order unavailable': unknown, or not shared with this account
        case notPermitted    // EXECUTE denied (42501)
        case signInRefused   // the session was refused (expired or bad JWT)
        case failed          // any other failure, in ReadFailure's words
    }

    let reader: String
    let kind: Kind
    let title: String
    let detail: String

    var text: String { "\(title). \(detail)" }
}

/// Why a Sign step did not go through, in plain words.
struct JobSignFailure: Error, Equatable {
    let text: String
}

enum JobLoad<T> {
    case loading
    case loaded(T)
    case refused(JobRefusal)
}

enum JobReaders {
    static let identityName = "my_identity_read"
    static let workOrdersName = "my_work_orders"
    static let jobPathName = "work_order_job_path_read"
    static let resourcesName = "work_order_resources_read"
    static let signatureQueueName = "my_signature_queue"
    static let quotesName = "work_order_quotes_read"
    static let vehicleWorkOrdersName = "vehicle_work_orders_read"
    static let statementName = "work_order_statement_read"

    // MARK: Calls

    static func myIdentity() async -> JobLoad<MyIdentity> {
        await call(identityName) { try await SupabaseService.client.rpc(identityName).execute().data }
    }

    static func myWorkOrders(slot: String? = nil, after: String? = nil, limit: Int = 25) async -> JobLoad<MyWorkOrders> {
        struct P: Encodable { let p_slot: String?; let p_after: String?; let p_limit: Int }
        return await call(workOrdersName) {
            try await SupabaseService.client.rpc(workOrdersName, params: P(p_slot: slot, p_after: after, p_limit: limit)).execute().data
        }
    }

    static func jobPath(workOrderId: String) async -> JobLoad<JobPath> {
        await call(jobPathName) {
            try await SupabaseService.client.rpc(jobPathName, params: ["p_work_order_id": workOrderId]).execute().data
        }
    }

    static func resources(workOrderId: String) async -> JobLoad<JobResources> {
        await call(resourcesName) {
            try await SupabaseService.client.rpc(resourcesName, params: ["p_work_order_id": workOrderId]).execute().data
        }
    }

    static func quotes(workOrderId: String) async -> JobLoad<JobQuotes> {
        await call(quotesName) {
            try await SupabaseService.client.rpc(quotesName, params: ["p_work_order_id": workOrderId]).execute().data
        }
    }

    static func vehicleWorkOrders(vehicleId: String, after: String? = nil, limit: Int = 25) async -> JobLoad<MyWorkOrders> {
        struct P: Encodable { let p_vehicle_id: String; let p_after: String?; let p_limit: Int }
        return await call(vehicleWorkOrdersName) {
            try await SupabaseService.client.rpc(vehicleWorkOrdersName, params: P(p_vehicle_id: vehicleId, p_after: after, p_limit: limit))
                .execute().data
        }
    }

    static func statement(vehicleId: String) async -> JobLoad<JobStatement> {
        await call(statementName) {
            try await SupabaseService.client.rpc(statementName, params: ["p_vehicle_id": vehicleId]).execute().data
        }
    }

    static func signatures() async -> JobLoad<SignatureQueue> {
        await call(signatureQueueName) { try await SupabaseService.client.rpc(signatureQueueName).execute().data }
    }

    // MARK: Sign steps (explicit; called only from a confirm button)

    /// Confirms one photo-derived work day through the server's own writer. Returns nil on
    /// success, or the reason in plain words.
    static func confirmWorkSession(_ item: SignatureItem) async -> String? {
        guard item.kind == "work_session", (item.sign?.rpc ?? "confirm_work_session") == "confirm_work_session" else {
            return "This step needs a newer version of the app."
        }
        struct P: Encodable { let p_session_id: String; let p_confirm: Bool }
        do {
            try await SupabaseService.client.rpc("confirm_work_session", params: P(p_session_id: item.refId, p_confirm: true)).execute()
            return nil
        } catch {
            NSLog("NukeCapture confirm_work_session failed: %@", String(describing: error))
            return ReadFailure.text(error)
        }
    }

    /// Accepts the current quote version through accept_work_order_quote, passing back exactly
    /// the quote id and hash the server offered in viewer.actions. Called only from the Accept
    /// quote sheet's confirm button.
    static func acceptQuote(_ action: JobAction, quote: Quote) async -> Result<QuoteAcceptanceReceipt, JobSignFailure> {
        guard let args = acceptArguments(action, quote: quote) else {
            return .failure(JobSignFailure(text: "This quote changed since you opened it. Refresh and review it again."))
        }
        struct P: Encodable { let p_quote_id: String; let p_quote_hash: String }
        do {
            let data = try await SupabaseService.client.rpc("accept_work_order_quote",
                                                            params: P(p_quote_id: args.id, p_quote_hash: args.hash)).execute().data
            return .success(try decode(QuoteAcceptanceReceipt.self, from: data))
        } catch {
            NSLog("NukeCapture accept_work_order_quote failed: %@", String(describing: error))
            return .failure(JobSignFailure(text: acceptFailureText(error)))
        }
    }

    /// The server-offered arguments, only when they name this exact quote version.
    static func acceptArguments(_ action: JobAction, quote: Quote) -> (id: String, hash: String)? {
        guard action.kind == "accept_quote", (action.rpc ?? "accept_work_order_quote") == "accept_work_order_quote",
              let id = action.args["p_quote_id"]?.stringValue, let hash = action.args["p_quote_hash"]?.stringValue,
              id == quote.quoteId, hash == quote.quoteHash else { return nil }
        return (id, hash)
    }

    static func acceptFailureText(_ error: Error) -> String {
        guard let pg = error as? PostgrestError else { return ReadFailure.text(error) }
        let m = pg.message
        if m.contains("hash does not match") { return "This quote changed since you opened it. Refresh and review it again." }
        if m.contains("quote_expired") { return "This quote has expired. Ask for a new one." }
        if m.contains("quote_superseded") { return "A newer version replaced this quote. Refresh to review it." }
        if m.contains("scope_changed_since_quote") { return "The work changed since this quote. Ask for an updated quote." }
        if m.contains("quoting_party_cannot_accept") { return "The person who wrote the quote can't accept it." }
        if m.contains("Quote unavailable") || m.contains("not_customer") || m.contains("quote_unavailable") {
            return "Only the customer on this job can accept this quote."
        }
        if m.contains("Authentication required") { return "Sign in to accept this quote." }
        return ReadFailure.text(error)
    }

    struct ActorHit: Decodable, Equatable, Identifiable {
        let id: String
        let name: String?
        let actor_type: String?
    }

    /// The name search term with the PostgREST pattern characters removed; nil when too short.
    static func actorSearchTerm(_ raw: String) -> String? {
        let cleaned = raw.unicodeScalars.filter { !"%_*,()\\".unicodeScalars.contains($0) }
        let term = String(String.UnicodeScalarView(cleaned)).trimmingCharacters(in: .whitespacesAndNewlines)
        return term.count >= 2 ? term : nil
    }

    /// Technician profiles by name: only the open columns (id, name, type), never contact.
    static func searchActors(_ raw: String) async -> Result<[ActorHit], JobRefusal> {
        guard let term = actorSearchTerm(raw) else { return .success([]) }
        do {
            let hits: [ActorHit] = try await SupabaseService.client.from("actors")
                .select("id,name,actor_type")
                .ilike("name", pattern: "%\(term)%")
                .order("name")
                .limit(25)
                .execute().value
            return .success(hits)
        } catch {
            return .failure(refusal("actors", error))
        }
    }

    struct ActorClaimInsert: Encodable, Equatable {
        let user_id: String
        let platform: String
        let handle: String
        let actor_id: String
        let verification_method: String

        init(userId: String, actorId: String) {
            user_id = userId
            platform = "nuke_actor"
            handle = actorId
            actor_id = actorId
            verification_method = "self_claim"
        }
    }

    /// Files "this technician profile is me" as a pending self-claim. Never automatic: the
    /// caller is a confirm button. Returns nil on success, or the reason in plain words.
    static func fileActorClaim(actorId: String) async -> String? {
        guard let uid = SupabaseService.currentUserId else { return "Sign in to link a technician profile." }
        do {
            try await SupabaseService.client.from("account_link_claims")
                .insert(ActorClaimInsert(userId: uid, actorId: actorId))
                .execute()
            return nil
        } catch let pg as PostgrestError where pg.code == "23505" {
            return "You've already linked this profile."
        } catch {
            NSLog("NukeCapture actor claim failed: %@", String(describing: error))
            return ReadFailure.text(error)
        }
    }

    static func call<T: Decodable>(_ reader: String, _ fetch: () async throws -> Data) async -> JobLoad<T> {
        do {
            return .loaded(try decode(T.self, from: try await fetch()))
        } catch {
            NSLog("NukeCapture %@ failed: %@", reader, String(describing: error))
            return .refused(refusal(reader, error))
        }
    }

    // MARK: Pure parts (unit-tested)

    /// A jsonb reader arrives as a bare object; an array-wrapped body is read as its first element.
    static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        let dec = JSONDecoder()
        do {
            return try dec.decode(T.self, from: data)
        } catch let objectError {
            guard let first = try? dec.decode([T].self, from: data).first else { throw objectError }
            return first
        }
    }

    static func refusal(_ reader: String, _ error: Error,
                        signedIn: Bool = SupabaseService.currentUserId != nil) -> JobRefusal {
        if let pg = error as? PostgrestError {
            if pg.message.contains("Profile unavailable") || pg.message.contains("Provider unavailable") {
                return JobRefusal(reader: reader, kind: .unavailable, title: "Profile not available",
                                  detail: "It's private, or it doesn't exist.")
            }
            if pg.message.contains("Vehicle unavailable") {
                return JobRefusal(reader: reader, kind: .unavailable, title: "Vehicle not available",
                                  detail: "It doesn't exist, or it isn't shared with you.")
            }
            if pg.message.contains("Part unavailable") {
                return JobRefusal(reader: reader, kind: .unavailable, title: "Part not available",
                                  detail: "It isn't on a job shared with you, or it doesn't exist.")
            }
            if pg.message.contains("Work order unavailable") {
                return JobRefusal(reader: reader, kind: .unavailable, title: "Job not available",
                                  detail: "It doesn't exist, or it isn't shared with you.")
            }
            if pg.message.contains("Sign-in required") || (pg.code == "42501" && !signedIn) {
                return JobRefusal(reader: reader, kind: .signInNeeded, title: "Sign in to see this",
                                  detail: "This is shown to signed-in accounts for now.")
            }
            switch pg.code {
            case "PGRST202", "42883":
                return pending(reader)
            case "42501":
                return JobRefusal(reader: reader, kind: .notPermitted, title: "Not available to your account",
                                  detail: "You don't have access to this yet.")
            default:
                break
            }
        }
        if let http = error as? HTTPError, http.response.statusCode == 404 {
            return pending(reader)
        }
        if SupabaseService.isAuthFailure(error) {
            return JobRefusal(reader: reader, kind: .signInRefused, title: "Sign in again", detail: "Your session has ended.")
        }
        return JobRefusal(reader: reader, kind: .failed, title: "Couldn't load", detail: ReadFailure.text(error))
    }

    static func pending(_ reader: String) -> JobRefusal {
        JobRefusal(reader: reader, kind: .readerPending, title: "Not available yet",
                   detail: "This part of Nuke is still being built.")
    }
}
