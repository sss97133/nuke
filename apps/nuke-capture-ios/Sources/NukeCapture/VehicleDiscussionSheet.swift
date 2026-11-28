// A vehicle's Nuke discussion and, when opened from a listing, the separately
// attributed discussion retained from that exact listing. Both are real reads;
// posting here writes only to Nuke.
import SwiftUI
import Supabase

struct ListingDiscussionEntry: Decodable, Identifiable {
    struct Parent: Decodable {
        let id: UUID
        let status: String?
        let deleted_at: String?
        let merged_into_vehicle_id: UUID?
    }
    struct CanonicalEvent: Decodable { let id: UUID }
    let id: UUID
    let vehicle_id: UUID
    let source_url: String?
    let posted_at: String?
    let author_username: String?
    let comment_text: String?
    let comment_type: String?
    let bid_amount: Decimal?
    let vehicles: Parent
    let auction_event_id: UUID?
    let canonical: CanonicalEvent?

    var typeLabel: String {
        switch comment_type {
        case "bid": return "Bid"
        case "seller_response": return "Seller response"
        case "question": return "Question"
        case "comment", "observation": return "Comment"
        default: return "Listing entry"
        }
    }
}

/// Restrict both the request and the returned records to one vehicle and one
/// listing. A known venue's tracking query is not part of the listing identity.
struct ListingDiscussionScope {
    let vehicleId: UUID
    let key: String
    let aliases: [String]
    let listingURL: URL

    init?(vehicleId: String, listingURL: URL?) {
        guard let vehicle = UUID(uuidString: vehicleId), let url = listingURL,
              let key = AuctionLocationClock.sourceKey(url.absoluteString),
              var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        parts.fragment = nil
        let host = (parts.host ?? "").lowercased()
        let knownVenue = ["bringatrailer.com", "www.bringatrailer.com", "carsandbids.com", "www.carsandbids.com"].contains(host)
        if knownVenue {
            parts.query = nil
        }
        let path = parts.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !path.isEmpty else { return nil }
        parts.path = "/" + path
        guard let withoutSlash = parts.string, let cleanURL = URL(string: withoutSlash) else { return nil }
        var aliases = Set<String>()
        let domain = host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
        let hosts = knownVenue ? [domain, "www." + domain] : [host]
        let schemes = knownVenue ? ["https", "http"] : [parts.scheme ?? "https"]
        let paths = knownVenue ? Set([parts.path, parts.path.lowercased()]) : [parts.path]
        for host in hosts {
            for scheme in schemes {
                for path in paths {
                    for suffix in ["", "/"] {
                        var alias = parts
                        alias.host = host; alias.scheme = scheme; alias.path = path + suffix
                        if let string = alias.string { aliases.insert(string) }
                    }
                }
            }
        }
        self.vehicleId = vehicle
        self.key = key
        self.aliases = aliases.sorted()
        self.listingURL = cleanURL
    }

    func contains(_ entry: ListingDiscussionEntry) -> Bool {
        entry.vehicle_id == vehicleId && entry.vehicles.id == vehicleId && entry.vehicles.deleted_at == nil
            && entry.vehicles.merged_into_vehicle_id == nil
            && !["deleted", "merged", "rejected", "duplicate"].contains(entry.vehicles.status ?? "")
            && (entry.auction_event_id == nil || entry.canonical?.id == entry.auction_event_id)
            && AuctionLocationClock.sourceKey(entry.source_url) == key
    }
}

struct DiscussionPostReply: Decodable {
    let ok: Bool?
    let kind: String?
    let comment_id: UUID?
    let error: String?

    var confirmed: Bool { ok == true && kind == "comment" && comment_id != nil }
}

private enum DiscussionLoad<Value> {
    case loading, failed, loaded(Value)
}

struct VehicleDiscussionSheet: View {
    let vehicleId: String
    var listingURL: URL? = nil
    var listingSource: String = "Listing"
    var onPosted: () async -> Void = {}

    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @EnvironmentObject private var session: SessionStore
    @State private var native: DiscussionLoad<VehicleEngagement> = .loading
    @State private var source: DiscussionLoad<[ListingDiscussionEntry]> = .loading
    @State private var loadedForViewer: String?
    @State private var draft = ""
    @State private var posting = false
    @State private var postMessage: String?
    @State private var showListing = true

    private var viewer: String {
        // SessionStore publishes auth events, including an account change.
        _ = session.isSignedIn
        return SupabaseService.currentUserId ?? "visitor"
    }
    private var scope: ListingDiscussionScope? { ListingDiscussionScope(vehicleId: vehicleId, listingURL: listingURL) }
    private func current(_ reader: String) -> Bool {
        !Task.isCancelled && scenePhase == .active && viewer == reader && loadedForViewer == reader
    }

    var body: some View {
        NavigationStack {
            Group {
                if scenePhase == .active && loadedForViewer == viewer {
                    VStack(spacing: 0) {
                        if scope != nil {
                            Picker("Discussion source", selection: $showListing) {
                                Text("Listing").tag(true)
                                Text("Nuke").tag(false)
                            }
                            .pickerStyle(.segmented)
                            .padding(.horizontal, 16).padding(.top, 12)
                        }
                        ScrollView {
                            VStack(alignment: .leading, spacing: 20) {
                                if showListing, let scope { sourceSection(scope) }
                                else { nativeSection }
                            }
                            .padding(16)
                        }
                    }
                    .safeAreaInset(edge: .bottom) { composer }
                } else {
                    ProgressView("Loading discussion…")
                }
            }
            .navigationTitle("Discussion")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() }.disabled(posting) } }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(posting)
        .onChange(of: viewer) { _, _ in draft = ""; postMessage = nil }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active && posting {
                postMessage = "We couldn't confirm the comment was posted. Check the discussion before retrying; your draft is still here."
            }
        }
        .task(id: "\(viewer)|\(scenePhase)") {
            guard scenePhase == .active else { loadedForViewer = nil; return }
            let reader = viewer
            loadedForViewer = reader
            native = .loading
            source = .loading
            async let a: Void = loadNative(reader)
            async let b: Void = loadSource(reader)
            _ = await (a, b)
        }
    }

    @ViewBuilder private func sourceSection(_ scope: ListingDiscussionScope) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("\(listingSource) discussion").font(.headline)
            Text("Up to 30 recent entries Nuke retained for this listing; newer entries may be missing.")
                .font(.caption).foregroundStyle(.secondary)
            switch source {
            case .loading:
                ProgressView("Loading listing discussion…")
            case .failed:
                VStack(alignment: .leading, spacing: 8) {
                    Text("Couldn't load the listing discussion.")
                    Button("Retry listing discussion") { Task { await loadSource(viewer) } }
                }.font(.subheadline)
            case .loaded(let entries):
                if entries.isEmpty {
                    Text("No matching listing entries were returned.")
                        .font(.subheadline).foregroundStyle(.secondary)
                } else {
                    ForEach(entries) { entry in
                        NavigationLink {
                            ListingDiscussionRecord(entry: entry, listingURL: scope.listingURL, source: listingSource)
                        } label: {
                            DiscussionRow(author: entry.author_username, at: entry.posted_at, label: entry.typeLabel,
                                          text: entry.comment_text, amount: entry.bid_amount)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("listing-discussion-\(entry.id.uuidString.lowercased())")
                    }
                }
            }
        }
    }

    private var nativeSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Nuke discussion").font(.headline)
            switch native {
            case .loading:
                ProgressView("Loading Nuke comments…")
            case .failed:
                VStack(alignment: .leading, spacing: 8) {
                    Text("Couldn't load Nuke comments.")
                    Button("Retry Nuke comments") { Task { await loadNative(viewer) } }
                }.font(.subheadline)
            case .loaded(let engagement):
                if engagement.recent_comments.isEmpty {
                    Text(engagement.comment_count == 0 ? "No Nuke comments yet." : "Recent Nuke comments aren't available.")
                        .font(.subheadline).foregroundStyle(.secondary)
                } else {
                    if engagement.comment_count > engagement.recent_comments.count {
                        Text("Showing \(engagement.recent_comments.count) of \(engagement.comment_count) Nuke comments.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    ForEach(engagement.recent_comments) { comment in
                        NavigationLink {
                            NativeDiscussionRecord(comment: comment)
                        } label: {
                            DiscussionRow(author: comment.is_me == true ? "You" : comment.author,
                                          at: comment.at, label: "Nuke comment", text: comment.text, amount: nil)
                        }.buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let postMessage { Text(postMessage).font(.caption).foregroundStyle(.secondary) }
            if viewer != "visitor" {
                Text("Comments you post here stay on Nuke; they aren't posted to the listing.")
                    .font(.caption2).foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    TextField("Add a Nuke comment…", text: $draft, axis: .vertical)
                        .textFieldStyle(.plain).lineLimit(1...4).submitLabel(.send)
                        .accessibilityIdentifier("discussion-composer")
                    Button { Task { await post() } } label: {
                        if posting { ProgressView().scaleEffect(0.7) }
                        else { Image(systemName: "arrow.up.circle.fill").font(.title2) }
                    }
                    .accessibilityLabel("Post Nuke comment")
                    .disabled(posting || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            } else {
                Text("Sign in to comment on Nuke.").font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12).background(.bar)
    }

    private func loadNative(_ reader: String) async {
        guard current(reader) else { return }
        native = .loading
        do {
            let value: VehicleEngagement = try await SupabaseService.client
                .rpc("get_vehicle_engagement", params: ["p_vehicle_id": vehicleId]).execute().value
            guard current(reader) else { return }
            native = .loaded(value)
        } catch {
            guard current(reader) else { return }
            native = .failed
        }
    }

    private func loadSource(_ reader: String) async {
        guard current(reader), let scope else { return }
        source = .loading
        do {
            let rows: [ListingDiscussionEntry] = try await SupabaseService.client.from("auction_comments")
                .select("id,vehicle_id,source_url,posted_at,author_username,comment_text,comment_type,bid_amount,auction_event_id,vehicles!inner(id,status,deleted_at,merged_into_vehicle_id),canonical:auction_events_canonical(id)")
                .or("auction_event_id.is.null,canonical.not.is.null")
                .eq("vehicle_id", value: vehicleId).in("source_url", values: scope.aliases)
                .eq("vehicles.is_public", value: true).is("vehicles.deleted_at", value: nil)
                .is("vehicles.merged_into_vehicle_id", value: nil)
                .or("and(or(status.is.null,status.not.in.(deleted,merged,rejected,duplicate)),or(listing_kind.is.null,listing_kind.neq.non_vehicle_item))", referencedTable: "vehicles")
                .order("posted_at", ascending: false).order("id", ascending: true).limit(31).execute().value
            guard current(reader) else { return }
            source = .loaded(Array(rows.filter(scope.contains).prefix(30)))
        } catch {
            guard current(reader) else { return }
            source = .failed
        }
    }

    private func post() async {
        let reader = viewer
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard current(reader), reader != "visitor", !posting, !text.isEmpty else { return }
        posting = true; postMessage = nil
        defer { posting = false }
        struct Params: Encodable {
            let p_kind = "comment", p_target_type = "vehicle"
            let p_target_id: String
            let p_payload: [String: String]
        }
        do {
            let reply: DiscussionPostReply = try await SupabaseService.client
                .rpc("record_interaction", params: Params(p_target_id: vehicleId, p_payload: ["text": text]))
                .execute().value
            guard current(reader) else { return }
            if reply.confirmed {
                if draft.trimmingCharacters(in: .whitespacesAndNewlines) == text { draft = "" }
                postMessage = "Posted to Nuke."
                showListing = false
                await loadNative(reader)
                if current(reader) { await onPosted() }
            } else if reply.ok == false {
                postMessage = "Nuke didn't accept that comment. Your draft is still here."
            } else {
                postMessage = "We couldn't confirm the comment was posted. Check the discussion before retrying; your draft is still here."
            }
        } catch {
            guard current(reader) else { return }
            postMessage = "We couldn't confirm the comment was posted. Check the discussion before retrying; your draft is still here."
        }
    }
}

private struct DiscussionRow: View {
    let author: String?
    let at: String?
    let label: String
    let text: String?
    let amount: Decimal?
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(author?.isEmpty == false ? author! : "Unknown author").font(.subheadline.weight(.semibold))
                Spacer()
                Text(label).font(.caption.weight(.medium)).foregroundStyle(.secondary)
            }
            if let at, let date = ProfileClock.date(at) {
                Text(date, format: .dateTime.year().month(.abbreviated).day()).font(.caption2).foregroundStyle(.secondary)
            }
            if let amount, text?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false {
                Text("Recorded amount: \(amount.formatted())").font(.caption)
            }
            if let text, !text.isEmpty {
                Text(text).font(.subheadline).lineLimit(4).frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 10))
    }
}

private struct ListingDiscussionRecord: View {
    let entry: ListingDiscussionEntry
    let listingURL: URL
    let source: String
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                DiscussionRow(author: entry.author_username, at: entry.posted_at, label: entry.typeLabel,
                              text: nil, amount: entry.comment_text?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? nil : entry.bid_amount)
                Text(entry.comment_text?.isEmpty == false ? entry.comment_text! : "No text recorded.")
                    .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                Link("Open the \(source) listing", destination: listingURL)
            }.padding(16)
        }
        .navigationTitle("Listing entry").navigationBarTitleDisplayMode(.inline)
    }
}

private struct NativeDiscussionRecord: View {
    let comment: VehicleEngagement.Comment
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                DiscussionRow(author: comment.is_me == true ? "You" : comment.author,
                              at: comment.at, label: "Nuke comment", text: nil, amount: nil)
                Text(comment.text?.isEmpty == false ? comment.text! : "No text recorded.")
                    .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
            }.padding(16)
        }
        .navigationTitle("Nuke comment").navigationBarTitleDisplayMode(.inline)
    }
}
