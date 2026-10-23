// NotificationDocument.swift — the signed-in account's notifications (user_notifications).
//
// Mirrors the web's NotificationCenter: the latest rows of user_notifications for auth.uid() under
// its own-row policy, newest first; the unread badge from get_unread_notification_count; a tap marks
// the row read through mark_notification_read and opens its subject; "Mark all read" calls
// mark_all_notifications_read. The kind is notification_type, else type (the web's coalesce).
// The phone composes no notification and writes nothing else to the table.
//
// What needs a Sign (offers, quotes, contact requests, payments to confirm) arrives through
// my_signature_queue, not here: on 2026-10-19 notify_offer_received targets a vehicle_offers table
// that does not exist and notify_payment_received fires on cash_transactions (one row, 2025-10-21).

import Foundation
import Supabase

struct UserNotification: Decodable, Equatable, Identifiable {
    let id: String
    let kind: String
    let title: String?
    let message: String?
    let vehicleId: String?
    let organizationId: String?
    let actionUrl: String?
    let metadata: [String: JobJSON]
    var isRead: Bool
    let createdAt: String?
    let readAt: String?

    enum CodingKeys: String, CodingKey {
        case id, type, title, message, metadata
        case notificationType = "notification_type"
        case vehicleId = "vehicle_id"
        case organizationId = "organization_id"
        case actionUrl = "action_url"
        case isRead = "is_read"
        case createdAt = "created_at"
        case readAt = "read_at"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        let nType = (try? c.decode(String.self, forKey: .notificationType)).flatMap { $0.isEmpty ? nil : $0 }
        let type = (try? c.decode(String.self, forKey: .type)).flatMap { $0.isEmpty ? nil : $0 }
        kind = nType ?? type ?? "unknown"
        title = (try? c.decode(String.self, forKey: .title)).flatMap { $0.isEmpty ? nil : $0 }
        message = (try? c.decode(String.self, forKey: .message)).flatMap { $0.isEmpty ? nil : $0 }
        vehicleId = try? c.decode(String.self, forKey: .vehicleId)
        organizationId = try? c.decode(String.self, forKey: .organizationId)
        actionUrl = (try? c.decode(String.self, forKey: .actionUrl)).flatMap { $0.isEmpty ? nil : $0 }
        metadata = (try? c.decode([String: JobJSON].self, forKey: .metadata)) ?? [:]
        isRead = (try? c.decode(Bool.self, forKey: .isRead)) == true
        createdAt = try? c.decode(String.self, forKey: .createdAt)
        readAt = try? c.decode(String.self, forKey: .readAt)
    }

    var route: NotificationRoute { NotificationRoute.of(self) }
}

/// One page of the account's notifications: the rows, the exact count of the same predicate and
/// the server's unread count (nil when that reader did not answer).
struct NotificationPage: Equatable {
    var rows: [UserNotification]
    let total: Int?
    var unread: Int?
    let limit: Int
    let unreadableRows: Int

    init(rows: [UserNotification], total: Int?, unread: Int?, limit: Int, unreadableRows: Int = 0) {
        self.rows = rows; self.total = total; self.unread = unread; self.limit = limit; self.unreadableRows = unreadableRows
    }

    /// Rows from the table's JSON; a row this build cannot read is counted, not shown.
    static func decode(_ data: Data, total: Int?, unread: Int?, limit: Int) throws -> NotificationPage {
        struct Slot: Decodable {
            let row: UserNotification?
            init(from decoder: Decoder) throws { row = try? UserNotification(from: decoder) }
        }
        let raw = try JSONDecoder().decode([Slot].self, from: data)
        let rows = raw.compactMap(\.row)
        return NotificationPage(rows: rows, total: total, unread: unread, limit: limit, unreadableRows: raw.count - rows.count)
    }

    var coverage: String {
        guard let total else { return "Latest \(rows.count) shown. Total not available." }
        if total <= rows.count { return total == 1 ? "1 notification." : "\(total) notifications." }
        return "Latest \(rows.count) of \(total) notifications."
    }
}

/// Which screen a notification opens. In-app subjects first (job, contact thread), then the web's
/// order: action_url, vehicle_id, organization_id. A web path this app has no screen for opens on
/// nuke.ag; a link to another site is not opened.
enum NotificationRoute: Equatable {
    case job(workOrderId: String)
    case contactThread(requestId: String)
    case vehicle(id: String)
    case organization(id: String)
    case web(URL)
    case none

    static let webHosts: Set<String> = ["nuke.ag", "www.nuke.ag"]

    static func of(_ n: UserNotification) -> NotificationRoute {
        if let id = n.metadata["contact_request_id"]?.stringValue, JobCopy.isIdentifier(id) { return .contactThread(requestId: id) }
        if let id = n.metadata["work_order_id"]?.stringValue, JobCopy.isIdentifier(id) { return .job(workOrderId: id) }
        if let url = n.actionUrl {
            let r = path(url)
            if r != .none { return r }
        }
        if let v = n.vehicleId, JobCopy.isIdentifier(v) { return .vehicle(id: v) }
        if let o = n.organizationId, JobCopy.isIdentifier(o) { return .organization(id: o) }
        return .none
    }

    /// A web route: a site-relative path, or an absolute https URL on nuke.ag.
    static func path(_ raw: String) -> NotificationRoute {
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let url: URL
        if s.hasPrefix("/") && !s.hasPrefix("//") {
            guard let u = URL(string: "https://nuke.ag" + s) else { return .none }
            url = u
        } else {
            guard let u = URL(string: s), u.scheme == "https", let host = u.host?.lowercased(), webHosts.contains(host) else { return .none }
            url = u
        }
        let parts = url.path.split(separator: "/").map(String.init)
        if parts.count >= 2, JobCopy.isIdentifier(parts[1]) {
            switch parts[0] {
            case "vehicle", "vehicles": return .vehicle(id: parts[1])
            case "org", "organization", "organizations": return .organization(id: parts[1])
            default: break
            }
        }
        return .web(url)
    }
}

enum NotificationCopy {
    static let emptyBody = "Nothing new. Offers, quotes and requests that need your answer are under Awaiting your signature and Messages."

    static func header(_ unread: Int?) -> String {
        guard let unread, unread > 0 else { return "Notifications" }
        return "Notifications · \(unread) unread"
    }

    static func kind(_ k: String) -> String {
        switch k {
        case "vehicle_merged": return "Vehicle merged"
        case "vehicle_update": return "Vehicle update"
        case "vin_needed": return "VIN needed"
        case "welcome": return "Welcome"
        case "profile_import_ready": return "Profile ready to claim"
        case "payment_received": return "Payment received"
        case "offer_received": return "Offer received"
        case "sale_completed": return "Sale completed"
        case "work_order_assigned": return "Job assigned"
        case "comment_on_vehicle": return "Comment"
        case "vehicle_access_request": return "Access request"
        case "verification_request": return "Verification request"
        case "ownership_claim": return "Ownership claim"
        case "unknown": return "Notification"
        default: return JobCopy.sentence(k)
        }
    }

    static func opens(_ route: NotificationRoute) -> String? {
        switch route {
        case .job: return "Opens the job"
        case .contactThread: return "Opens the conversation"
        case .vehicle: return "Opens the vehicle"
        case .organization: return "Opens the organization"
        case .web: return "Opens on nuke.ag"
        case .none: return nil
        }
    }

    static func markedAll(_ n: Int) -> String {
        n == 1 ? "Marked 1 notification read." : "Marked \(n) notifications read."
    }

    static func failure(_ error: Error) -> String {
        if let pg = error as? PostgrestError, pg.message.contains("only mark your own") {
            return "The server didn't recognize this account. Sign in again."
        }
        return ReadFailure.text(error)
    }
}

// MARK: - Readers and writers (writers only from a user's tap)

enum NotificationReaders {
    static let table = "user_notifications"
    static let unreadName = "get_unread_notification_count"
    static let markOneName = "mark_notification_read"
    static let markAllName = "mark_all_notifications_read"
    static let columns = "id,type,notification_type,title,message,vehicle_id,organization_id,action_url,metadata,is_read,read_at,created_at"
    static let pageLimit = 50

    static func page(limit: Int = pageLimit) async -> JobLoad<NotificationPage> {
        guard let uid = SupabaseService.currentUserId else {
            return .refused(JobRefusal(reader: table, kind: .signInNeeded, title: "Sign in to see this",
                                       detail: "Notifications are shown to signed-in accounts."))
        }
        do {
            async let unread = unreadCount()
            let response = try await SupabaseService.client.from(table)
                .select(columns, count: .exact)
                .eq("user_id", value: uid)
                // A notification is raised live: its created_at is its event time (no upload backlog).
                .order("created_at", ascending: false)
                .limit(limit)
                .execute()
            return .loaded(try NotificationPage.decode(response.data, total: response.count, unread: await unread, limit: limit))
        } catch {
            NSLog("NukeCapture %@ failed: %@", table, String(describing: error))
            return .refused(JobReaders.refusal(table, error))
        }
    }

    /// The server's unread count for this account; nil when it did not answer.
    static func unreadCount() async -> Int? {
        guard let uid = SupabaseService.currentUserId else { return nil }
        do {
            let data = try await SupabaseService.client.rpc(unreadName, params: ["p_user_id": uid]).execute().data
            return try JSONDecoder().decode(Int.self, from: data)
        } catch {
            NSLog("NukeCapture %@ failed: %@", unreadName, String(describing: error))
            return nil
        }
    }

    /// nil on success, or the reason in plain words.
    static func markRead(_ id: String) async -> String? {
        guard let uid = SupabaseService.currentUserId else { return "Sign in to mark notifications read." }
        struct P: Encodable { let p_user_id: String; let p_notification_id: String }
        do {
            let data = try await SupabaseService.client.rpc(markOneName, params: P(p_user_id: uid, p_notification_id: id)).execute().data
            return (try? JSONDecoder().decode(Bool.self, from: data)) == false ? "This notification is no longer there." : nil
        } catch {
            NSLog("NukeCapture %@ failed: %@", markOneName, String(describing: error))
            return NotificationCopy.failure(error)
        }
    }

    /// The number the server marked read, or the reason in plain words.
    static func markAllRead() async -> Result<Int, JobSignFailure> {
        guard let uid = SupabaseService.currentUserId else { return .failure(JobSignFailure(text: "Sign in to mark notifications read.")) }
        do {
            let data = try await SupabaseService.client.rpc(markAllName, params: ["p_user_id": uid]).execute().data
            return .success((try? JSONDecoder().decode(Int.self, from: data)) ?? 0)
        } catch {
            NSLog("NukeCapture %@ failed: %@", markAllName, String(describing: error))
            return .failure(JobSignFailure(text: NotificationCopy.failure(error)))
        }
    }
}

// MARK: - The Work tab badge

/// What the Work tab badge counts: the server's unread notifications plus the signature queue's
/// stated total (which already holds contact requests to answer). Either part the server did not
/// state is left out; with neither, there is no badge.
@MainActor
final class InboxBadgeStore: ObservableObject {
    static let shared = InboxBadgeStore()

    @Published var unreadNotifications: Int?
    @Published var toSign: Int?

    var badge: Int { Self.badge(unread: unreadNotifications, toSign: toSign) }

    nonisolated static func badge(unread: Int?, toSign: Int?) -> Int {
        max(unread ?? 0, 0) + max(toSign ?? 0, 0)
    }

    nonisolated static func toSign(_ queue: JobLoad<SignatureQueue>) -> Int? {
        guard case .loaded(let q) = queue else { return nil }
        return q.coverage?.total ?? q.items.count
    }

    func refresh() async {
        guard SupabaseService.currentUserId != nil else { clear(); return }
        async let unread = NotificationReaders.unreadCount()
        async let queue = JobReaders.signatures()
        unreadNotifications = await unread
        toSign = Self.toSign(await queue)
    }

    func clear() {
        unreadNotifications = nil
        toSign = nil
    }
}
