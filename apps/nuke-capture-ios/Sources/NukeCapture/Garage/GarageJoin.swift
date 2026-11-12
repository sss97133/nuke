// GarageJoin.swift — the garage join link, phone side: parse the link, remember it across sign-in, preview it,
// redeem it, and mint one for a technician. Server contract: docs/garage-model/JOIN_LINK.md (the functions are
// DRAFTS, not deployed). Every call degrades: when the server does not have the function yet the answer is
// `.notAvailable` ("Garage invites aren't available yet"), never an error dialog and never a faked success.
//
// Pure logic lives here so UnitTests/GarageJoinTests.swift can pin it without a network: URL parsing, the
// pending-token store, the error classifier and the two state machines run against a backend protocol.
// The raw token is a credential for as long as the link is live: it is never logged, and the phone keeps it only
// until the link has produced an answer (or seven days, whichever is first).

import Foundation
import Supabase

// MARK: - The link

enum JoinLink {
    /// Web host of the universal link (Associated Domains `applinks:nuke.ag`, project.yml).
    static let universalHosts: Set<String> = ["nuke.ag", "www.nuke.ag"]
    /// The app's registered custom scheme (project.yml CFBundleURLTypes): `ag.nuke.capture://join/<token>`.
    static let customScheme = "ag.nuke.capture"
    static let customHost = "join"

    /// 32 random bytes, base64url without padding (server: create_garage_join_link).
    static func isToken(_ s: String) -> Bool {
        guard s.utf8.count == 43 else { return false }
        return s.utf8.allSatisfy { c in
            (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) || c == 0x2D || c == 0x5F
        }
    }

    /// The token carried by `https://nuke.ag/join/<token>` or `ag.nuke.capture://join/<token>`; nil for any other URL
    /// (the existing `ag.nuke.capture://sync` and `login-callback` doors are untouched).
    static func token(from url: URL) -> String? {
        let scheme = url.scheme?.lowercased()
        let host = url.host?.lowercased()
        let parts = url.pathComponents.filter { $0 != "/" }
        if scheme == "https", let host, universalHosts.contains(host) {
            guard parts.count == 2, parts[0] == "join", isToken(parts[1]) else { return nil }
            return parts[1]
        }
        if scheme == customScheme, host == customHost {
            guard parts.count == 1, isToken(parts[0]) else { return nil }
            return parts[0]
        }
        return nil
    }

    static func url(forToken token: String) -> URL {
        URL(string: "https://nuke.ag/join/\(token)")!
    }
}

// MARK: - What the server answers

struct JoinPreview: Decodable, Equatable {
    let garageName: String?
    let role: String?
    let valid: Bool
    let reason: String

    enum CodingKeys: String, CodingKey { case garageName = "garage_name", role, valid, reason }
}

struct JoinMembership: Decodable, Equatable {
    let memberId: String
    let status: String

    enum CodingKeys: String, CodingKey { case memberId = "member_id", status }
}

enum JoinInvalidReason: String, Equatable {
    case notFound = "not_found"
    case expired, revoked, exhausted
    case garageClosed = "garage_closed"
    case garageBusy = "garage_busy"
    case membershipRevoked = "membership_revoked"

    var title: String {
        switch self {
        case .notFound: return "This link isn't valid"
        case .expired: return "This link has expired"
        case .revoked: return "This link was withdrawn"
        case .exhausted: return "This link has been used up"
        case .garageClosed: return "This garage is closed"
        case .garageBusy: return "This garage has too many requests waiting"
        case .membershipRevoked: return "You can't join from this link"
        }
    }

    var detail: String {
        switch self {
        case .notFound: return "Check that you opened the whole link, or ask for a new one."
        case .expired, .revoked, .exhausted: return "Ask the person who sent it for a new link."
        case .garageClosed: return "It isn't taking members."
        case .garageBusy: return "Try again later, or ask the garage to clear its requests."
        case .membershipRevoked: return "A manager at this garage decides whether you can come back."
        }
    }
}

enum JoinError: Error, Equatable {
    case notAvailable                  // the RPC is not deployed (PGRST202 / 42883 / HTTP 404)
    case invalid(JoinInvalidReason)    // the link itself is no good
    case signInRequired
    case notPermitted                  // rank refused (42501)
    case failed(String)

    static let notAvailableTitle = "Garage invites aren't available yet"
    static let notAvailableDetail = "This part of Nuke is still being built. Your link is fine; try it again after the next update."

    /// Pure classifier so the mapping is testable without a network.
    static func classify(code: String?, message: String, httpStatus: Int?) -> JoinError {
        if code == "PGRST202" || code == "42883" || httpStatus == 404 { return .notAvailable }
        if let raw = Self.reason(inMessage: message), let r = JoinInvalidReason(rawValue: raw) { return .invalid(r) }
        if code == "28000" { return .signInRequired }
        if code == "42501" { return .notPermitted }
        return .failed(message)
    }

    static func from(_ error: Error) -> JoinError {
        if let e = error as? JoinError { return e }
        if let pg = error as? PostgrestError { return classify(code: pg.code, message: pg.message, httpStatus: nil) }
        if let http = error as? HTTPError { return classify(code: nil, message: "HTTP \(http.response.statusCode)", httpStatus: http.response.statusCode) }
        if SupabaseService.isAuthFailure(error) { return .signInRequired }
        return .failed(ReadFailure.text(error))
    }

    /// `join_link_<reason>` out of a RAISE message such as "join_link_expired" or "join_link_rank_required: manager or above".
    static func reason(inMessage message: String) -> String? {
        guard let r = message.range(of: "join_link_") else { return nil }
        let tail = message[r.upperBound...].prefix { $0.isLowercase || $0 == "_" }
        return tail.isEmpty ? nil : String(tail)
    }
}

// MARK: - The pending token (survives sign-in and a relaunch)

struct JoinTokenStore {
    static let key = "garage.join.pending"
    static let maxAge: TimeInterval = 7 * 24 * 3600

    var defaults: UserDefaults = .standard
    var now: () -> Date = Date.init

    func save(_ token: String) {
        defaults.set(["token": token, "at": now().timeIntervalSince1970] as [String: Any], forKey: Self.key)
    }

    func load() -> String? {
        guard let d = defaults.dictionary(forKey: Self.key), let t = d["token"] as? String, let at = d["at"] as? Double,
              JoinLink.isToken(t), now().timeIntervalSince1970 - at <= Self.maxAge else {
            if defaults.object(forKey: Self.key) != nil { clear() }
            return nil
        }
        return t
    }

    func clear() { defaults.removeObject(forKey: Self.key) }
}

// MARK: - Backend

protocol GarageJoinBackend {
    func preview(token: String) async throws -> JoinPreview
    func redeem(token: String) async throws -> JoinMembership
}

enum GarageJoinService: GarageJoinBackend {
    case live

    private struct TokenParams: Encodable { let p_token: String }

    /// Anon-callable on the server; rides the user's JWT when there is one.
    func preview(token: String) async throws -> JoinPreview {
        do {
            let rows: [JoinPreview] = try await SupabaseService.client.rpc("preview_garage_join_link", params: TokenParams(p_token: token)).execute().value
            guard let row = rows.first else { throw JoinError.failed("The server returned no answer for this link.") }
            return row
        } catch { throw JoinError.from(error) }
    }

    func redeem(token: String) async throws -> JoinMembership {
        do {
            let rows: [JoinMembership] = try await SupabaseService.client.rpc("redeem_garage_join_link", params: TokenParams(p_token: token)).execute().value
            guard let row = rows.first else { throw JoinError.failed("The server returned no answer for this link.") }
            return row
        } catch { throw JoinError.from(error) }
    }
}

// MARK: - The join screen's state machine

enum JoinPhase: Equatable {
    case loading
    case offer(JoinPreview)            // valid link; the person decides
    case signInNeeded(JoinPreview)     // valid link, no session yet: sign in, then the same screen resumes
    case working
    case pending(garage: String?, role: String?)   // waiting for a manager
    case active(garage: String?, role: String?)
    case invalid(JoinInvalidReason, garage: String?)
    case notAvailable
    case blocked(String)               // suspended or an unexpected membership state, in words
    case failed(String)                // transient (network): retry is offered

    /// The link has given its answer: the phone forgets the token.
    var isTerminal: Bool {
        switch self {
        case .pending, .active, .invalid, .notAvailable, .blocked: return true
        case .loading, .offer, .signInNeeded, .working, .failed: return false
        }
    }
}

@MainActor
final class JoinLinkModel: ObservableObject {
    @Published private(set) var phase: JoinPhase = .loading
    let token: String
    private let backend: GarageJoinBackend
    private let isSignedIn: () -> Bool
    private let onTerminal: () -> Void
    private var preview: JoinPreview?

    init(token: String, backend: GarageJoinBackend = GarageJoinService.live,
         isSignedIn: @escaping () -> Bool, onTerminal: @escaping () -> Void = {}) {
        self.token = token
        self.backend = backend
        self.isSignedIn = isSignedIn
        self.onTerminal = onTerminal
    }

    func load() async {
        phase = .loading
        do {
            let p = try await backend.preview(token: token)
            preview = p
            if p.valid {
                phase = isSignedIn() ? .offer(p) : .signInNeeded(p)
            } else {
                set(.invalid(JoinInvalidReason(rawValue: p.reason) ?? .notFound, garage: p.garageName))
            }
        } catch {
            set(Self.phase(for: JoinError.from(error)))
        }
    }

    /// The person taps Join (or "Check again": redeem is idempotent and returns the current state).
    func accept() async {
        guard isSignedIn() else {
            if let preview { phase = .signInNeeded(preview) }
            return
        }
        phase = .working
        do {
            let m = try await backend.redeem(token: token)
            switch m.status {
            case "active": set(.active(garage: preview?.garageName, role: preview?.role))
            case "pending": set(.pending(garage: preview?.garageName, role: preview?.role))
            case "suspended": set(.blocked("Your membership here is suspended. Ask a manager."))
            default: set(.blocked("The server answered with a membership state this version doesn't know."))
            }
        } catch {
            set(Self.phase(for: JoinError.from(error)))
        }
    }

    /// Back from sign-in: the token is still pending, so show the offer again.
    func signedInNow() async {
        if preview == nil { await load() } else if let p = preview, p.valid { phase = .offer(p) }
    }

    static func phase(for error: JoinError) -> JoinPhase {
        switch error {
        case .notAvailable: return .notAvailable
        case .invalid(let r): return .invalid(r, garage: nil)
        case .signInRequired: return .failed("Sign in to join.")
        case .notPermitted: return .blocked("Your account can't do this.")
        case .failed(let text): return .failed(text)
        }
    }

    private func set(_ p: JoinPhase) {
        phase = p
        if p.isTerminal { onTerminal() }
    }
}

// MARK: - Routing: which link is open, and resuming after sign-in

struct JoinRoute: Identifiable, Equatable {
    let token: String
    var id: String { token }
}

@MainActor
final class JoinLinkCoordinator: ObservableObject {
    static let shared = JoinLinkCoordinator()

    @Published var route: JoinRoute?
    private let store: JoinTokenStore

    init(store: JoinTokenStore = JoinTokenStore()) { self.store = store }

    /// A URL arrived (universal link or custom scheme). True when it was a join link (consumed).
    @discardableResult
    func handle(url: URL) -> Bool {
        guard let token = JoinLink.token(from: url) else { return false }
        store.save(token)
        if route?.token != token { route = JoinRoute(token: token) }
        return true
    }

    /// Launch and sign-in: a token saved earlier (signed out when the link was tapped) comes back.
    func resumePending() {
        guard route == nil, let token = store.load() else { return }
        route = JoinRoute(token: token)
    }

    /// The link answered (or was dismissed after answering): forget it.
    func finish() { store.clear() }

    /// The sheet closed. A link that never answered stays saved for the next launch or sign-in.
    func closed() { route = nil }
}
