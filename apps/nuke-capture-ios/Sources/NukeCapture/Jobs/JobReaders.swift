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
        case notPermitted    // EXECUTE denied or the row is not this account's (42501)
        case signInRefused   // the session was refused (expired or bad JWT)
        case failed          // any other failure, in ReadFailure's words
    }

    let reader: String
    let kind: Kind
    let title: String
    let detail: String

    var text: String { "\(title). \(detail)" }
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

    static func signatures() async -> JobLoad<SignatureQueue> {
        await call(signatureQueueName) { try await SupabaseService.client.rpc(signatureQueueName).execute().data }
    }

    private static func call<T: Decodable>(_ reader: String, _ fetch: () async throws -> Data) async -> JobLoad<T> {
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

    static func refusal(_ reader: String, _ error: Error) -> JobRefusal {
        if let pg = error as? PostgrestError {
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
