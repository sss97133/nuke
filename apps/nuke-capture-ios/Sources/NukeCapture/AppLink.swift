// AppLink.swift — nuke.ag links opened in the app (universal links: applinks:nuke.ag).
//
// Paths follow nuke_frontend's routes: /jobs/:workOrderId (JobPage), /providers/:handle (ProviderProfilePage),
// /org/:id (OrganizationRoutes) and /supplier-invite/:token (SupplierInvitePage). Jobs, providers and organizations
// open their native screens; an invite, and anything the app has no screen for, opens the same nuke.ag page in an
// in-app browser so a shared link never dead-ends. The site's apple-app-site-association lists the same paths.

import SwiftUI
import Supabase

enum AppLink: Identifiable, Equatable {
    case job(String)
    case provider(String)
    case org(String)
    case web(URL)

    static let hosts: Set<String> = ["nuke.ag", "www.nuke.ag"]

    var id: String {
        switch self {
        case .job(let id): return "job-" + id
        case .provider(let h): return "provider-" + h
        case .org(let id): return "org-" + id
        case .web(let u): return "web-" + u.absoluteString
        }
    }

    /// The screen for a nuke.ag https link; nil for any other URL (the OAuth callback scheme included).
    static func parse(_ url: URL) -> AppLink? {
        guard url.scheme?.lowercased() == "https", let host = url.host?.lowercased(), hosts.contains(host) else { return nil }
        let parts = url.pathComponents.filter { $0 != "/" }
        guard let head = parts.first?.lowercased(), parts.count >= 2 else { return .web(url) }
        let key = parts[1]
        switch head {
        case "jobs" where parts.count == 2 && isUUID(key): return .job(key.lowercased())
        case "providers" where parts.count == 2 && key.range(of: #"^[A-Za-z0-9_.\-]{1,64}$"#, options: .regularExpression) != nil:
            return .provider(key)
        case "org" where isUUID(key): return .org(key.lowercased())
        default: return .web(url)
        }
    }

    private static func isUUID(_ s: String) -> Bool { UUID(uuidString: s) != nil }
}

/// The sheet a link opens: the native screen, or the page itself.
struct AppLinkView: View {
    let link: AppLink
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        switch link {
        case .web(let url):
            InAppBrowser(url: url).ignoresSafeArea()
        case .job(let id):
            framed { JobView(workOrderId: id) }
        case .org(let id):
            framed { OrganizationView(orgId: id) }
        case .provider(let handle):
            framed { ProviderHandleView(handle: handle) }
        }
    }

    private func framed<V: View>(@ViewBuilder _ content: () -> V) -> some View {
        NavigationStack {
            content()
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) { Button("Done") { dismiss() } }
                }
        }
    }
}

/// /providers/:handle: the handle resolves to a public profile the way the web page does (profiles.username).
struct ProviderHandleView: View {
    enum Resolution: Equatable { case looking, found(String), missing(String) }

    let handle: String
    @State private var resolution: Resolution = .looking

    var body: some View {
        List {
            switch resolution {
            case .looking:
                Section { ProgressView() }
            case .missing(let why):
                Section { Text(why).font(.footnote).foregroundStyle(.secondary) }
            case .found(let id):
                ProviderFaceSection(userId: id, showSubject: true)
            }
        }
        .navigationTitle("@\(handle)")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: handle) { resolution = await Self.resolve(handle) }
    }

    static func resolve(_ handle: String) async -> Resolution {
        struct Row: Decodable { let id: String }
        do {
            let rows: [Row] = try await SupabaseService.client.from("profiles").select("id").eq("username", value: handle).limit(1)
                .execute().value
            guard let id = rows.first?.id else { return .missing("No public profile on Nuke uses @\(handle).") }
            return .found(id.lowercased())
        } catch {
            return .missing("Couldn't look up @\(handle) right now.")
        }
    }
}
