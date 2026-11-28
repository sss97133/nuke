// ExplorePagerCard.swift — one Explore card as a horizontal pager.
//
//   photos   → every photo of the vehicle (cover first, read on the first swipe, at most 60), the price and
//              the doors (clock, bid) stay on each photo; "n / N" shows once N is known
//   location → a still map centred on the listing's rounded coordinates (classified rows that have them)
//   analytics→ the listing's own clock (a classified's age; a lot's listed date and length). The cohort and
//              projection evidence is on the price rail and its long-press stack, not repeated here
//   listing  → the source's mark and "Opening <Source>…"; settling here opens the original listing and
//              the pager returns to the page before it
//
// Under the card: Comments, Follow (signed in), Share and the listing. A long press gives the
// feed's own choices (more / less / hide) and the listing's link. Every action is also a local signal
// (ExploreSignals.swift). The pager is the GarageCard recipe: a fixed-size box sizes the card and a
// page-style TabView fills it, so vertical scrolling of the feed is untouched.

import SwiftUI
import MapKit
import UIKit

/// The per-card reads. Photos only; a failed read leaves the cover alone.
@MainActor
enum ExploreCardReads {
    private static let cache = CoalescingCache<[GarageReelPhoto]>(ttl: 300, limit: 200)

    /// The vehicle's gallery-eligible, non-sensitive photos in the web's order (primary, position, upload),
    /// at most ExplorePhotos.cap, from the signed-in or public source the profile reads. nil when the read fails.
    static func photos(_ vehicleId: String) async -> [GarageReelPhoto]? {
        let viewer = SupabaseService.currentUserId ?? "visitor"
        return try? await cache.value(vehicleId + "|" + viewer) {
            let rows: [GarageReelPhoto] = try await VehicleGalleryImage.eligible(SupabaseService.client
                .from(VehicleImageLoader.source)
                .select("image_url,taken_at,is_sensitive")
                .eq("vehicle_id", value: vehicleId))
                .not("is_sensitive", operator: .is, value: "true")
                .order("is_primary", ascending: false, nullsFirst: false)
                .order("position", ascending: true, nullsFirst: false)
                .order("created_at", ascending: true)
                .limit(ExplorePhotos.cap)
                .execute().value
            return rows
        }
    }
}

/// What a card has seen while it is in view; read when it leaves.
final class ExploreCardTracker {
    var visibleSince: Date?
    var maxPageIndex = 0
    var maxPageKind: ExplorePageKind = .photos
    var maxPhoto = 0
}

/// record_interaction('follow') answers {"ok": true, "following": bool}, or {"ok": false, "error": …} signed out.
private struct ExploreFollowReply: Decodable {
    let ok: Bool?
    let kind: String?
    let following: Bool?
}

struct ExplorePagerCard: View {
    let item: ExploreFeedItem
    /// The card's index in the feed, for the signal log.
    let position: Int
    var hasBidReading = false
    /// This lot's projected-hammer reading from the feed's single board read, and whether that board is fresh.
    var finish: FinishEstimate? = nil
    var finishFresh = false
    let onDrill: (ExploreCardDrill) -> Void
    let onOpenProfile: (ExploreFeedItem) -> Void
    let onOpenDiscussion: (ExploreFeedItem) -> Void
    let onChoice: (ExploreSignalEvent.Choice, ExploreFeedItem) -> Void
    /// Opens the "why this range" stack for this card.
    let onWhy: (ExploreFeedItem) -> Void

    private enum PageID: Hashable {
        case photo(Int), waiting, location, analytics, listing

        var kind: ExplorePageKind {
            switch self {
            case .photo, .waiting: return .photos
            case .location: return .location
            case .analytics: return .analytics
            case .listing: return .listing
            }
        }
    }

    @State private var selected: PageID = .photo(0)
    @State private var lastBeforeListing: PageID = .photo(0)
    @State private var reel: [GarageReelPhoto]?
    @State private var reelAsked = false
    @State private var reelFailed = false
    @State private var mapWarm = false
    @State private var tracker = ExploreCardTracker()
    @State private var following: Bool?
    @State private var followViewer: String?
    @State private var followBusy = false
    @State private var followNeedsCheck = false
    @State private var followMessage: String?
    @State private var followEpoch = 0
    @State private var tick = 0
    @State private var followTick = 0
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @EnvironmentObject private var session: SessionStore

    // MARK: Pages

    private var photoURLs: [String] { ExplorePhotos.urls(cover: item.image, reel: reel ?? []) }

    /// One waiting page after the cover until the reel is read (the first swipe onto it reads the reel).
    private var awaitingReel: Bool { reel == nil && !reelFailed && item.vehicleId != nil }

    private var pageIDs: [PageID] {
        let count = photoURLs.count
        var out: [PageID] = (0..<max(count, 1)).map { PageID.photo($0) }
        if awaitingReel { out.append(.waiting) }
        for kind in ExplorePagePlan.kinds(for: item) {
            switch kind {
            case .photos: break
            case .location: out.append(.location)
            case .analytics: out.append(.analytics)
            case .listing: out.append(.listing)
            }
        }
        return out
    }

    // MARK: Body

    var body: some View {
        VStack(alignment: .leading, spacing: NukeSpace.sm) {
            VStack(alignment: .leading, spacing: NukeSpace.md) {
                pager
                indicator
                titleBlock
            }
            .contextMenu { menu } preview: {
                ExploreCardPreview(item: item) { record(.press) }
            }
            actions
            if let followMessage {
                Text(followMessage).font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, NukeSpace.lg)
        .onScrollVisibilityChange(threshold: 0.5) { visible in
            if visible { began() } else { ended() }
        }
        .onDisappear { ended() }
        .onChange(of: selected) { _, now in selectionChanged(now) }
        .onChange(of: viewer) { _, _ in
            followEpoch += 1; following = nil; followViewer = nil
            followNeedsCheck = false; followMessage = nil
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase != .active else { return }
            followEpoch += 1; following = nil; followViewer = nil
            if followBusy {
                followNeedsCheck = true
                followMessage = "Couldn't confirm the follow change. Tap Check follow to see its current status."
            } else {
                followNeedsCheck = false; followMessage = nil
            }
        }
        .onChange(of: pageIDs) { _, ids in
            // The waiting page goes away once the reel is read; never leave the pager on a page that is gone.
            if !ids.contains(selected) { selected = .photo(0) }
        }
        .sensoryFeedback(.selection, trigger: tick)
        .sensoryFeedback(.success, trigger: followTick)
    }

    private var pager: some View {
        Color(.secondarySystemFill)
            .frame(maxWidth: .infinity)
            .aspectRatio(NukeSize.heroPhotoAspect, contentMode: .fit)
            .overlay {
                TabView(selection: $selected) {
                    ForEach(pageIDs, id: \.self) { id in
                        page(id).tag(id)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
            }
            .overlay(alignment: .topTrailing) {
                if case .photo(let i) = selected,
                   let text = ExplorePhotos.counter(index: i, total: photoURLs.count, reelKnown: reel != nil) {
                    Text(text)
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.white)
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .background(.black.opacity(0.55), in: Capsule())
                        .padding(NukeSpace.sm)
                        .allowsHitTesting(false)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: NukeRadius.hero, style: .continuous))
            .shadow(color: .black.opacity(0.12), radius: 10, y: 4)
            .accessibilityElement(children: .contain)
    }

    @ViewBuilder private func page(_ id: PageID) -> some View {
        switch id {
        case .photo(let i): photoPage(i)
        case .waiting:
            Color(.tertiarySystemFill)
                .overlay { ProgressView() }
                .accessibilityLabel(Text("More photos"))
        case .location: locationPage
        case .analytics: analyticsPage
        case .listing: listingPage
        }
    }

    // MARK: Photo page

    private func photoPage(_ i: Int) -> some View {
        let urls = photoURLs
        let url = i < urls.count ? urls[i] : item.image
        return NukePhoto(url: NukeImage.thumb(url, width: 1080), maxPixel: 1280)
            .overlay(alignment: .bottom) {
                LinearGradient(colors: [.clear, .black.opacity(0.6)], startPoint: .center, endPoint: .bottom)
                    .allowsHitTesting(false)
            }
            .overlay(alignment: .bottomLeading) {
                ExploreCardOverlay(item: item, hasBidReading: hasBidReading, onDrill: onDrill,
                                   rail: ExplorePriceRail.make(item: item, estimate: finish, fresh: finishFresh),
                                   onWhy: whyAction)
                    .padding(NukeSpace.lg)
            }
            .contentShape(Rectangle())
            .onTapGesture { openProfile() }
            .accessibilityLabel(Text(reel == nil ? "Photo" : "Photo \(i + 1) of \(urls.count)"))
    }

    // MARK: Location page

    /// The map is built only when its page is the selected one or next to it, and then kept.
    private var mapNear: Bool {
        let ids = pageIDs
        guard let at = ids.firstIndex(of: .location), let now = ids.firstIndex(of: selected) else { return false }
        return abs(at - now) <= 1
    }

    @ViewBuilder private var locationPage: some View {
        if let lat = item.lat, let lng = item.lng, ExplorePagePlan.hasCoordinates(item) {
            let center = CLLocationCoordinate2D(latitude: lat, longitude: lng)
            ZStack(alignment: .bottomLeading) {
                if mapNear || mapWarm {
                    // Still on purpose: the pager's swipe must keep working over the map.
                    Map(initialPosition: .region(MKCoordinateRegion(center: center,
                                                                    span: MKCoordinateSpan(latitudeDelta: 0.6, longitudeDelta: 0.6))),
                        interactionModes: []) {
                        Marker(item.location ?? "Listing area", coordinate: center)
                    }
                    .mapStyle(.standard)
                    .allowsHitTesting(false)
                } else {
                    Color(.tertiarySystemFill)
                }
                Text("Approximate point, rounded to about a kilometre.")
                    .font(.caption2)
                    .padding(.horizontal, NukeSpace.sm).padding(.vertical, 4)
                    .background(.ultraThinMaterial, in: Capsule())
                    .padding(NukeSpace.md)
                    .allowsHitTesting(false)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("Map of the listing's area, \(item.location ?? "location recorded")"))
        }
    }

    // MARK: Analytics page

    /// The listing's own clock only (a classified's age; a lot's listed date and length). The cohort evidence
    /// is on the price rail and its stack, so it is not repeated here.
    private var analyticsPage: some View {
        let reading = ExploreAnalytics.reading(for: item, now: Date())
        var rows: [(symbol: String, text: String)] = []
        if let t = reading.age { rows.append(("clock", t)) }
        if let t = reading.listed { rows.append(("calendar", t)) }
        if let t = reading.length { rows.append(("hourglass", "Auction length \(t)")) }
        return VStack(alignment: .leading, spacing: NukeSpace.md) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                Label(row.text, systemImage: row.symbol).font(.nukeHeadline).lineLimit(2)
            }
            Spacer(minLength: 0)
        }
        .padding(NukeSpace.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color(.secondarySystemGroupedBackground))
        .accessibilityElement(children: .combine)
    }

    // MARK: Listing page

    private var listingPage: some View {
        Button { openListing() } label: {
            VStack(spacing: NukeSpace.md) {
                if let url = item.sourceLogoURL { NukeSourceLogo(url: url, name: item.source) } else { NukePill(text: item.source) }
                Text("Opening \(item.source)…").font(.nukeDetail).foregroundStyle(.secondary)
                Image(systemName: "arrow.up.right.square").font(.title3).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(.secondarySystemGroupedBackground))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(Text("Opens \(item.source) in the browser."))
    }

    // MARK: Indicator and title

    /// A thin segment per kind of page; the one you are on is filled.
    private var indicator: some View {
        let kinds = ExplorePagePlan.kinds(for: item)
        return HStack(spacing: 4) {
            ForEach(kinds, id: \.rawValue) { kind in
                Capsule()
                    .fill(kind == selected.kind ? Color.primary : Color(.tertiarySystemFill))
                    .frame(height: 4)
                    .frame(maxWidth: .infinity)
            }
        }
        .padding(.horizontal, NukeSpace.xs)
        .animation(.easeOut(duration: 0.15), value: selected)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Page: \(selected.kind.rawValue)"))
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: NukeSpace.xs) {
            Text(item.title).font(.nukeCardTitle).lineLimit(2)
            if let subtitle = item.subtitle {
                Text(subtitle).font(.nukeDetail).foregroundStyle(.secondary).lineLimit(2)
            }
            ExploreSourceDoor(item: item, onDrill: onDrill).padding(.top, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, NukeSpace.xs)
        .contentShape(Rectangle())
        .onTapGesture { openProfile() }
    }

    // MARK: Actions under the card

    private var viewer: String? {
        _ = session.isSignedIn
        return SupabaseService.currentUserId
    }
    private var canFollow: Bool { item.vehicleId != nil && viewer != nil }
    private var shownFollowing: Bool { followViewer == viewer && following == true }

    private var actions: some View {
        HStack(spacing: 0) {
            if item.vehicleId != nil {
                actionButton("Comments", "bubble.left") {
                    record(.commentOpen)
                    onOpenDiscussion(item)
                }
            }
            if canFollow {
                actionButton(followNeedsCheck ? "Check follow" : (shownFollowing ? "Following" : "Follow"),
                             shownFollowing ? "checkmark.circle.fill" : "plus.circle") {
                    Task { await follow() }
                }
                .disabled(followBusy)
            }
            if let link = item.link {
                ShareLink(item: link) { ExploreActionLabel(symbol: "square.and.arrow.up", title: "Share") }
                    .simultaneousGesture(TapGesture().onEnded {
                        tick += 1
                        record(.share)
                    })
                actionButton("Listing", "arrow.up.right.square") { openListing() }
            }
        }
        .buttonStyle(.plain)
    }

    private func actionButton(_ title: String, _ symbol: String, action: @escaping () -> Void) -> some View {
        Button {
            tick += 1
            action()
        } label: {
            ExploreActionLabel(symbol: symbol, title: title)
        }
    }

    // MARK: Press menu

    @ViewBuilder private var menu: some View {
        let hasTaste = ExplorePreferences.key(item) != nil
        if item.amount != nil {
            Button { showWhy() } label: { Label("Why this range", systemImage: "chart.bar.doc.horizontal") }
        }
        Button { choose(.more) } label: { Label("Show more like this", systemImage: "hand.thumbsup") }
            .disabled(!hasTaste)
        Button { choose(.less) } label: { Label("Show less like this", systemImage: "hand.thumbsdown") }
            .disabled(!hasTaste)
        Button(role: .destructive) { choose(.hide) } label: { Label("Hide this listing", systemImage: "eye.slash") }
        if let link = item.link {
            Button { openListing() } label: { Label("Open listing", systemImage: "arrow.up.right.square") }
            Button { UIPasteboard.general.string = link.absoluteString } label: { Label("Copy link", systemImage: "doc.on.doc") }
            ShareLink(item: link) { Label("Share", systemImage: "square.and.arrow.up") }
        }
    }

    private func choose(_ choice: ExploreSignalEvent.Choice) {
        record(.choice) { $0.choice = choice }
        onChoice(choice, item)
    }

    // MARK: Actions

    /// A long press on the price opens the stack, when the card has a price.
    private var whyAction: (() -> Void)? {
        guard item.amount != nil else { return nil }
        return { showWhy() }
    }

    private func showWhy() {
        record(.press)
        onWhy(item)
    }

    private func openProfile() {
        record(.openProfile)
        onOpenProfile(item)
    }

    private func openListing() {
        guard let link = item.link else { return }
        Haptics.drill(depth: 1)
        record(.openListing)
        openURL(link)
    }

    /// The server writer toggles. Read before every change and only toggle if
    /// the fresh state differs from the action the person actually selected.
    /// An uncertain write requires a read-only check before another toggle.
    private func follow() async {
        guard let vid = item.vehicleId?.uuidString.lowercased(), let user = viewer,
              scenePhase == .active, !followBusy else { return }
        followBusy = true
        defer { followBusy = false }
        let epoch = followEpoch
        let checkOnly = followNeedsCheck
        let desired = !shownFollowing
        var writing = false
        func current() -> Bool { !Task.isCancelled && viewer == user && scenePhase == .active && followEpoch == epoch }
        do {
            let engagement: VehicleEngagement = try await SupabaseService.client
                .rpc("get_vehicle_engagement", params: ["p_vehicle_id": vid])
                .execute().value
            guard current() else { return }
            following = engagement.is_following; followViewer = user
            followNeedsCheck = false; followMessage = nil
            if checkOnly || engagement.is_following == desired { return }
            writing = true
            let reply: ExploreFollowReply = try await SupabaseService.client
                .rpc("record_interaction", params: ["p_kind": "follow", "p_target_type": "vehicle", "p_target_id": vid])
                .execute().value
            guard current() else { return }
            if reply.ok == false {
                followMessage = "Nuke didn't change follow. Try again."
                return
            }
            guard reply.ok == true, reply.kind == "follow", let actual = reply.following else {
                following = nil; followNeedsCheck = true
                followMessage = "Couldn't confirm the follow change. Tap Check follow to see its current status."
                return
            }
            following = actual
            if actual != desired {
                followNeedsCheck = true
                followMessage = "Follow status changed. Tap Check follow to see its current status."
                return
            }
            followTick += 1
            record(.follow)
        } catch {
            guard current() else { return }
            following = nil; followNeedsCheck = true
            followMessage = writing
                ? "Couldn't confirm the follow change. Tap Check follow to see its current status."
                : "Couldn't check follow status. Tap Check follow to try again."
        }
    }

    // MARK: Selection, photos, signals

    private func selectionChanged(_ now: PageID) {
        if now != .listing { lastBeforeListing = now }
        if now == .location { mapWarm = true }
        if now != .photo(0) { loadReel() }
        if let idx = pageIDs.firstIndex(of: now), idx > tracker.maxPageIndex {
            tracker.maxPageIndex = idx
            tracker.maxPageKind = now.kind
        }
        if case .photo(let i) = now {
            if i > tracker.maxPhoto { tracker.maxPhoto = i }
            prefetchPhotos(after: i)
        }
        if now == .listing {
            // The pager has settled on the last page: go to the listing, then come back to the page before it.
            openListing()
            let back = lastBeforeListing
            Task {
                try? await Task.sleep(nanoseconds: 450_000_000)
                if selected == .listing {
                    withAnimation { selected = pageIDs.contains(back) ? back : .photo(0) }
                }
            }
        }
    }

    private func loadReel() {
        guard !reelAsked, let vid = item.vehicleId?.uuidString.lowercased() else { return }
        reelAsked = true
        Task {
            let rows = await ExploreCardReads.photos(vid)
            guard let rows else { reelFailed = true; return }
            reel = rows
            if selected == .waiting { selected = photoURLs.count > 1 ? .photo(1) : .photo(0) }
            prefetchPhotos(after: 0)
        }
    }

    /// The next two photos are fetched and decoded ahead, at the size the page draws them.
    private func prefetchPhotos(after i: Int) {
        let urls = photoURLs
        guard i + 1 < urls.count else { return }
        for j in (i + 1)...min(i + 2, urls.count - 1) {
            if let u = NukeImage.thumb(urls[j], width: 1080) {
                Task(priority: .utility) { _ = await RemoteImageCache.shared.image(u, maxPixel: 1280) }
            }
        }
    }

    private func record(_ kind: ExploreSignalEvent.Kind, mutate: ((inout ExploreSignalEvent) -> Void)? = nil) {
        var event = ExploreSignalEvent.make(kind, item: item, position: position)
        event.pageKind = selected.kind.rawValue
        event.pageIndex = pageIDs.firstIndex(of: selected)
        if case .photo(let i) = selected { event.photoIndex = i }
        mutate?(&event)
        let final = event
        Task { await ExploreSignalLog.shared.append(final) }
    }

    /// The card is more than half in view: one impression, and the pager's reach starts from where it is.
    private func began() {
        guard tracker.visibleSince == nil else { return }
        tracker.visibleSince = Date()
        tracker.maxPageIndex = pageIDs.firstIndex(of: selected) ?? 0
        tracker.maxPageKind = selected.kind
        if case .photo(let i) = selected { tracker.maxPhoto = i } else { tracker.maxPhoto = 0 }
        record(.impression)
    }

    /// It left the screen: how long it was in view, the furthest page and the furthest photo reached.
    private func ended() {
        guard let since = tracker.visibleSince else { return }
        tracker.visibleSince = nil
        let ms = Int(Date().timeIntervalSince(since) * 1000)
        let pageIndex = tracker.maxPageIndex, pageKind = tracker.maxPageKind, photo = tracker.maxPhoto
        record(.dwell) { $0.dwellMs = ms }
        record(.page) { $0.pageIndex = pageIndex; $0.pageKind = pageKind.rawValue }
        if photo > 0 { record(.photo) { $0.photoIndex = photo } }
        Task { await ExploreSignalLog.shared.flushIfEnabled() }
    }
}

/// An icon over a short word, at least 44 points tall; the row under the card shares four of them.
private struct ExploreActionLabel: View {
    let symbol: String
    let title: String

    var body: some View {
        VStack(spacing: 2) {
            Image(systemName: symbol).font(.system(size: 18, weight: .regular))
            Text(title).font(.caption2)
        }
        .foregroundStyle(.primary)
        .frame(maxWidth: .infinity, minHeight: NukeSize.minTap)
        .contentShape(Rectangle())
    }
}

/// What the long press lifts: the cover, the name and the line under it.
private struct ExploreCardPreview: View {
    let item: ExploreFeedItem
    let onShow: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: NukeSpace.sm) {
            NukePhoto(url: NukeImage.thumb(item.image, width: 800), maxPixel: 1000)
                .aspectRatio(NukeSize.heroPhotoAspect, contentMode: .fit)
                .clipped()
            Text(item.title).font(.nukeCardTitle).lineLimit(2).padding(.horizontal, NukeSpace.md)
            if let subtitle = item.subtitle {
                Text(subtitle).font(.nukeDetail).foregroundStyle(.secondary).lineLimit(2)
                    .padding(.horizontal, NukeSpace.md)
            }
        }
        .padding(.bottom, NukeSpace.md)
        .frame(width: 320)
        .onAppear(perform: onShow)
    }
}
