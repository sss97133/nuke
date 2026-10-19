// ContactDocument.swift — Contact via Nuke: requests, the inbox and threads (#2160).
//
// People reach each other only through Nuke: a request (request_contact) names a context (a
// profile, work order, requirement or vehicle) and a short message; the recipient accepts or
// declines (respond_contact_request); an accepted request opens a two-party thread
// (post_contact_message, contact_thread_read). Delivery is in-app only and contact fields are
// never exposed. Readers carry a contact block {action, available, request{writer, context}};
// the phone offers the button only when the server says available.

import Foundation
import Supabase

/// The contact block a reader returns. `available` is the server's decision for this viewer.
struct ContactBlock: Decodable, Equatable {
    let action: String?
    let available: Bool
    let contextKind: String?
    let contextId: String?
    let recipientUserId: String?
    let recipientActorId: String?
    let recipientOrganizationId: String?

    enum CodingKeys: String, CodingKey { case action, available, request }
    private struct Request: Decodable {
        let context_kind: String?
        let context_id: String?
        let recipient_user_id: String?
        let recipient_actor_id: String?
        let recipient_organization_id: String?
    }

    init(action: String? = "contact_via_nuke", available: Bool, contextKind: String?, contextId: String?,
         recipientUserId: String? = nil, recipientActorId: String? = nil, recipientOrganizationId: String? = nil) {
        self.action = action; self.available = available; self.contextKind = contextKind; self.contextId = contextId
        self.recipientUserId = recipientUserId; self.recipientActorId = recipientActorId
        self.recipientOrganizationId = recipientOrganizationId
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        action = try? c.decode(String.self, forKey: .action)
        available = (try? c.decode(Bool.self, forKey: .available)) == true
        let r = try? c.decode(Request.self, forKey: .request)
        contextKind = r?.context_kind
        contextId = r?.context_id.flatMap { JobCopy.isIdentifier($0) ? $0 : nil }
        recipientUserId = r?.recipient_user_id
        recipientActorId = r?.recipient_actor_id
        recipientOrganizationId = r?.recipient_organization_id
    }

    /// Offer the button only when the server allows it and names a context the writer accepts.
    var canRequest: Bool {
        available && action == "contact_via_nuke" && contextId != nil
            && ["work_order", "requirement", "vehicle", "profile"].contains(contextKind ?? "")
    }
}

struct ContactItem: Decodable, Equatable, Identifiable {
    let requestId: String
    let direction: String
    let counterpart: JobPerson?
    let recipientKind: String?
    let contextKind: String?
    let contextLabel: String?
    let message: String?
    let status: String
    let createdAt: String?
    let respondedAt: String?
    let withdrawnAt: String?
    let threadMessages: Int
    let lastMessageAt: String?
    let actions: [String]

    var id: String { requestId }

    enum CodingKeys: String, CodingKey {
        case direction, counterpart, context, message, status, thread, actions
        case requestId = "request_id"
        case recipientKind = "recipient_kind"
        case createdAt = "created_at"
        case respondedAt = "responded_at"
        case withdrawnAt = "withdrawn_at"
    }
    private struct Context: Decodable { let kind: String?; let label: String? }
    private struct Thread: Decodable { let messages: Int?; let last_message_at: String? }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        requestId = try c.decode(String.self, forKey: .requestId)
        direction = (try? c.decode(String.self, forKey: .direction)) ?? "incoming"
        counterpart = try? c.decode(JobPerson.self, forKey: .counterpart)
        recipientKind = try? c.decode(String.self, forKey: .recipientKind)
        let ctx = try? c.decode(Context.self, forKey: .context)
        contextKind = ctx?.kind
        contextLabel = ctx?.label.flatMap { $0.isEmpty ? nil : $0 }
        message = try? c.decode(String.self, forKey: .message)
        status = (try? c.decode(String.self, forKey: .status)) ?? "pending"
        createdAt = try? c.decode(String.self, forKey: .createdAt)
        respondedAt = try? c.decode(String.self, forKey: .respondedAt)
        withdrawnAt = try? c.decode(String.self, forKey: .withdrawnAt)
        let t = try? c.decode(Thread.self, forKey: .thread)
        threadMessages = t?.messages ?? 0
        lastMessageAt = t?.last_message_at
        actions = (try? c.decode([String].self, forKey: .actions)) ?? []
    }

    var canRespond: Bool { actions.contains("respond_contact_request") }
    var canWithdraw: Bool { actions.contains("withdraw_contact_request") }
    var canMessage: Bool { actions.contains("post_contact_message") }
}

struct ContactInbox: Decodable, Equatable {
    var incoming: [ContactItem]
    var outgoing: [ContactItem]
    let requestsPerDay: Int?
    let requestsSentLastDay: Int?

    enum CodingKeys: String, CodingKey { case incoming, outgoing, limits }
    private struct Limits: Decodable { let requests_per_day: Int?; let requests_sent_last_day: Int? }
    private struct Slot: Decodable {
        let item: ContactItem?
        init(from decoder: Decoder) throws { item = try? ContactItem(from: decoder) }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        incoming = ((try? c.decode([Slot].self, forKey: .incoming)) ?? []).compactMap(\.item)
        outgoing = ((try? c.decode([Slot].self, forKey: .outgoing)) ?? []).compactMap(\.item)
        let l = try? c.decode(Limits.self, forKey: .limits)
        requestsPerDay = l?.requests_per_day
        requestsSentLastDay = l?.requests_sent_last_day
    }

    /// Requests left today, when the server states both numbers.
    var requestsLeftToday: Int? {
        guard let per = requestsPerDay, let sent = requestsSentLastDay else { return nil }
        return max(per - sent, 0)
    }

    var pendingIncoming: Int { incoming.filter { $0.status == "pending" }.count }
}

struct ContactMessage: Decodable, Equatable, Identifiable {
    let messageId: String
    let author: JobPerson?
    let body: String
    let createdAt: String?
    var id: String { messageId }

    enum CodingKeys: String, CodingKey {
        case author, body
        case messageId = "message_id"
        case createdAt = "created_at"
    }

    var fromYou: Bool { author?.kind == "you" }
}

struct ContactThread: Decodable, Equatable {
    let request: ContactItem?
    let messages: [ContactMessage]
    let canPost: Bool

    enum CodingKeys: String, CodingKey {
        case request, messages
        case canPost = "can_post"
    }
    private struct Slot: Decodable {
        let message: ContactMessage?
        init(from decoder: Decoder) throws { message = try? ContactMessage(from: decoder) }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        request = try? c.decode(ContactItem.self, forKey: .request)
        messages = ((try? c.decode([Slot].self, forKey: .messages)) ?? []).compactMap(\.message)
        canPost = (try? c.decode(Bool.self, forKey: .canPost)) == true
    }
}

struct ContactSendReceipt: Decodable, Equatable {
    let requestId: String?
    let status: String?
    let recipient: JobPerson?

    enum CodingKeys: String, CodingKey {
        case status, recipient
        case requestId = "request_id"
    }
}

// MARK: - Words

enum ContactCopy {
    static let neverShared = "Your email and phone are never shared."
    static let sent = "Sent in Nuke. They'll see it in their inbox. \(neverShared)"

    static func status(_ s: String) -> String {
        switch s {
        case "pending": return "Waiting for a reply"
        case "accepted": return "Accepted"
        case "declined": return "Declined"
        case "withdrawn": return "Withdrawn"
        default: return JobCopy.sentence(s)
        }
    }

    /// What a request is about; an incoming profile request is about your own profile.
    static func context(_ kind: String?, _ label: String?, incoming: Bool = false) -> String {
        if let label { return label }
        switch kind {
        case "profile"?: return incoming ? "Your profile" : "Their profile"
        case "work_order"?: return "A job"
        case "requirement"?: return "An open requirement"
        case "vehicle"?: return "A vehicle"
        default: return "Nuke"
        }
    }

    static func leftToday(_ n: Int?) -> String? {
        guard let n else { return nil }
        switch n {
        case 0: return "You've reached today's limit for new requests."
        case 1: return "You can send 1 more request today."
        default: return "You can send \(n) more requests today."
        }
    }

    static func whoCanRead(_ recipientKind: String?) -> String {
        recipientKind == "organization" ? "Only you and the shop's team can read this." : "Only the two of you can read this."
    }

    /// The writers' refusals in plain words.
    static func failure(_ error: Error) -> String {
        guard let pg = error as? PostgrestError else { return ReadFailure.text(error) }
        let m = pg.message
        if m.contains("limit reached") { return m.contains("Thread") ? "You've sent a lot in this conversation today. Try again tomorrow." : "You've reached today's limit for new requests. Try again tomorrow." }
        if m.contains("already exists") { return "You already have a request waiting with them about this." }
        if m.contains("cannot contact yourself") { return "That's you." }
        if m.contains("No reachable recipient") || m.contains("context unavailable") || m.contains("request unavailable") {
            return "This person can't be reached through Nuke right now."
        }
        if m.contains("Messages open after") { return "Messages open once they accept your request." }
        if m.contains("Message must be") { return "Keep it shorter." }
        if m.contains("Sign-in required") { return "Sign in to contact people through Nuke." }
        if m.contains("Contact request is") { return "This request was already answered." }
        return ReadFailure.text(error)
    }
}

// MARK: - Readers and writers (writers only from explicit buttons)

enum ContactReaders {
    static func inbox() async -> JobLoad<ContactInbox> {
        await JobReaders.call("my_contact_requests") {
            try await SupabaseService.client.rpc("my_contact_requests").execute().data
        }
    }

    static func thread(_ requestId: String) async -> JobLoad<ContactThread> {
        await JobReaders.call("contact_thread_read") {
            try await SupabaseService.client.rpc("contact_thread_read", params: ["p_request_id": requestId]).execute().data
        }
    }

    struct SendParams: Encodable, Equatable {
        let p_context_kind: String
        let p_context_id: String
        let p_message: String
        let p_recipient_user_id: String?
        let p_recipient_actor_id: String?
        let p_recipient_organization_id: String?
    }

    /// The request body exactly as the server's contact block names it; nil when it names nothing sendable.
    static func sendParams(_ block: ContactBlock, message: String) -> SendParams? {
        let text = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard block.canRequest, let kind = block.contextKind, let id = block.contextId, (1...500).contains(text.count) else { return nil }
        return SendParams(p_context_kind: kind, p_context_id: id, p_message: text,
                          p_recipient_user_id: block.recipientUserId, p_recipient_actor_id: block.recipientActorId,
                          p_recipient_organization_id: block.recipientOrganizationId)
    }

    static func send(_ block: ContactBlock, message: String) async -> Result<ContactSendReceipt, JobSignFailure> {
        guard let params = sendParams(block, message: message) else {
            return .failure(JobSignFailure(text: "Write a short message first."))
        }
        do {
            let data = try await SupabaseService.client.rpc("request_contact", params: params).execute().data
            return .success(try JobReaders.decode(ContactSendReceipt.self, from: data))
        } catch {
            NSLog("NukeCapture request_contact failed: %@", String(describing: error))
            return .failure(JobSignFailure(text: ContactCopy.failure(error)))
        }
    }

    static func respond(_ requestId: String, accept: Bool) async -> String? {
        struct P: Encodable { let p_id: String; let p_accept: Bool }
        return await write("respond_contact_request", P(p_id: requestId, p_accept: accept))
    }

    static func withdraw(_ requestId: String) async -> String? {
        await write("withdraw_contact_request", ["p_id": requestId])
    }

    static func post(_ requestId: String, body: String) async -> String? {
        let text = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (1...2000).contains(text.count) else { return "Write a message first." }
        struct P: Encodable { let p_request_id: String; let p_body: String }
        return await write("post_contact_message", P(p_request_id: requestId, p_body: text))
    }

    /// nil on success, or the reason in plain words.
    private static func write<P: Encodable & Sendable>(_ rpc: String, _ params: P) async -> String? {
        do {
            try await SupabaseService.client.rpc(rpc, params: params).execute()
            return nil
        } catch {
            NSLog("NukeCapture %@ failed: %@", rpc, String(describing: error))
            return ContactCopy.failure(error)
        }
    }
}
