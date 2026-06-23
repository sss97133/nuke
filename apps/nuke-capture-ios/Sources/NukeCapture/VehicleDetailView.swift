// VehicleDetailView.swift — the drill target from a photo's "View vehicle" row
// AND from the Explore grid.
//
// Build-2 §5: a real record, drillable. A traditional build sheet — hero, the
// "YEAR MAKE MODEL TRIM" title, a SPEC TABLE (only the fields that exist), a
// PHOTOS strip into a full-screen gallery, the INVESTMENT proof ledger (proven
// vs projected), and a CTA out to the web profile. Read-only, anon-safe.
//
// Two call sites, one view:
//   • PhotoFullScreenView / ProfileTab present it as a .sheet → embedInNavigationStack
//     defaults to TRUE, so it carries its own NavigationStack + Done button.
//   • ExploreView PUSHES it via .navigationDestination → embedInNavigationStack:false,
//     so the pushing stack owns the bar/back chevron (no dead-end Done button).

import SwiftUI
import UIKit
import Supabase
import Charts          // value-trajectory accrual curve
import AVFoundation   // chime on a real arbitrated bid (motion = derivative of data)

/// One vehicles row — exact columns, read-only. Header + full spec set in a
/// single select so one fetch covers the title bar AND the spec table.
/// Hashable so it can be a NavigationLink/​.navigationDestination value.
struct VehicleHeaderRow: Decodable, Identifiable, Hashable {
    let id: UUID
    let year: Int?
    let make: String?
    let model: String?
    let trim: String?
    let primary_image_url: String?
    // Location only — the spec values + their provenance now come from
    // get_vehicle_specs (rooted fact-vs-facade), NOT from this row. The header
    // fetch carries just the title parts, the hero, and the location.
    let city: String?
    let state: String?

    /// "YEAR MAKE MODEL TRIM" — only the parts that exist, never a lone "—".
    var title: String {
        var parts: [String] = []
        if let year { parts.append(String(year)) }   // String(): avoid "2,017" locale formatting
        if let make, !make.isEmpty { parts.append(make) }
        if let model, !model.isEmpty { parts.append(model) }
        if let trim, !trim.isEmpty { parts.append(trim) }
        return parts.joined(separator: " ").uppercased()
    }

    // Identity by id is enough — two rows with the same vehicle id are the same
    // record. Avoids hashing every optional spec column.
    static func == (lhs: VehicleHeaderRow, rhs: VehicleHeaderRow) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

/// One vehicle_images row — the gallery unit. Small Decodable, exact columns.
/// Carries the per-image analysis atoms so a tap opens the photo's analysis
/// (the photo→analysis path) without a second fetch. All atom fields optional —
/// a photo renders "Not analyzed yet" when they're absent, never a fabrication.
struct VehicleGalleryImage: Decodable, Identifiable {
    let id: UUID
    let image_url: String?
    let thumbnail_url: String?
    let is_primary: Bool?
    // Analysis atoms (vision verdict) — present once the image is understood.
    let taken_at: String?
    let labels: [String]?      // 'scene:x' / 'phase:y' / 'intent:z' + components
    let ai_processing_status: String?
}

// SALE HISTORY — real sale events from vehicle_timeline_events (same table the build-days
// RPC reads; no new RPC). Deduped by (date|price|listing) because multiple ingest paths
// write the SAME sale, which the profile otherwise reads as "sold twice" — a rendering
// artifact, never a real resale. Each row drills to its source listing.
private struct SaleEventRow: Decodable {
    let id: UUID
    let event_type: String
    let event_date: String?          // "yyyy-MM-dd"
    let title: String?
    let metadata: SaleMeta?
    struct SaleMeta: Decodable {
        let final_price: Double?; let sale_price: Double?; let high_bid: Double?
        let platform: String?; let source_url: String?; let listing_url: String?
        let lot_number: String?; let bid_count: Int?
        var price: Double? { final_price ?? sale_price ?? high_bid }
        var url: String? { listing_url ?? source_url }
    }
}
private struct Sale: Identifiable {
    let id: String                   // "date|int price|url" — the dedup key
    let date: String?; let price: Double?; let platform: String?
    let url: String?; let lot: String?; let bids: Int?
}

/// The signed-in viewer's ASSET relationship to this vehicle — his ownership /
/// provenance. Read from the SAME tables the web uses (vehicle_user_permissions
/// + ownership_verifications), never fabricated. nil when the vehicle is not the
/// viewer's (tenet 5 / C0): the app never claims ownership of a vehicle that
/// isn't his (e.g. a sold truck).
private struct VehiclePermissionRow: Decodable {
    let role: String?
    let granted_at: String?
    let is_active: Bool?
    let revoked_at: String?
}
private struct OwnershipVerificationRow: Decodable {
    let status: String?            // approved | expired | pending | rejected
    let approved_at: String?
    let verification_type: String?
    let verification_category: String?
}
struct VehicleRelationship {
    let role: String               // owner | co_owner | contributor | …
    let since: String?             // "yyyy-MM-dd" granted_at
    let titleVerified: Bool        // an APPROVED title verification exists
    let verificationStatus: String? // honest state when not approved (expired/pending)
    let verifiedAt: String?
}

/// The market-cohort drill a header identity chip opens. Identifiable so it drives
/// a `.sheet(item:)`. id keyed on the triple so re-tapping the same identity is a no-op.
struct CohortDrill: Identifiable, Hashable {
    let make: String
    let model: String
    let year: Int
    var id: String { "\(year)|\(make)|\(model)" }
}

private extension View {
    /// Stock inset-grouped card: the data section floats as a rounded
    /// `secondarySystemGroupedBackground` panel on the grouped page — the native
    /// Settings / Photos-info idiom, replacing flat monospace-on-white. The values
    /// inside (RootedValueView, the barcode, the worth bracket) are unchanged; only
    /// the container becomes stock. iOS gives the material + dark-mode for free.
    func nukeCard() -> some View {
        self
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(Color(.secondarySystemGroupedBackground),
                        in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .padding(.horizontal, 16)
            .padding(.bottom, 12)
    }
}

/// One vital sign in the living header. The KIND carries the glyph + meaning on ONE
/// vocabulary (so the storm signals slot in beside today's); the text is the count.
/// `live` distinguishes a real, backed signal from a wired-but-dark storm slot.
struct PulseSignal: Identifiable {
    enum Kind { case viewers, weighedIn, following, contributions, activity, bids, estimate }
    let kind: Kind
    let text: String
    var live: Bool = true

    var id: String { "\(kind)" }

    var glyph: String {
        switch kind {
        case .viewers:       return "eye.fill"
        case .weighedIn:     return "bubble.left.fill"
        case .following:     return "person.2.fill"
        case .contributions: return "hammer.fill"
        case .activity:      return "bolt.fill"
        case .bids:          return "gavel.fill"
        case .estimate:      return "hourglass"
        }
    }

    /// $112,200 → "$112k". Short enough to live in a pinned strip.
    static func shortMoney(_ v: Double) -> String {
        if v >= 1000 {
            let k = (v / 1000).rounded()
            return "$\(Int(k))k"
        }
        return "$\(Int(v.rounded()))"
    }
}

/// The activity pulse — the vehicle's vital signs as a tight glyph·count strip in
/// the living header. Live signals read in ink; a dark storm slot reads tertiary.
struct PulseStrip: View {
    let signals: [PulseSignal]
    var body: some View {
        HStack(spacing: 11) {
            ForEach(signals) { sig in
                HStack(spacing: 3) {
                    Image(systemName: sig.glyph).font(.system(size: 10, weight: .semibold))
                    Text(sig.text).font(.caption2.weight(.semibold)).monospacedDigit()
                        .lineLimit(1)
                }
                .foregroundStyle(sig.live ? AnyShapeStyle(.primary) : AnyShapeStyle(.tertiary))
            }
        }
        .fixedSize()   // the vital signs never compress — the title truncates instead
    }
}

/// The canonical live-signal row (public.vehicle_pulse), arbitrated server-side. The
/// living header subscribes to it via Realtime; both web and iOS read the SAME row.
struct VehiclePulse: Decodable {
    let mode: String
    let headline_label: String?
    let headline_amount: Double?
    let is_live: Bool
    let live_state: String
    let liveness: Double
    let urgency_pulse_ms: Int?
    let ends_at: String?       // ISO; parsed client-side so the countdown is smooth
    let live_bid: Double?
    let bid_count: Int
    let source_platform: String?

    var displayBid: Double? { live_bid ?? headline_amount }
    var endsAtDate: Date? {
        guard let s = ends_at else { return nil }
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: s) ?? { let g = ISO8601DateFormatter(); return g.date(from: s) }()
    }
}

struct VehicleDetailView: View {
    let vehicleId: String
    /// TRUE (default) = wrap in own NavigationStack + show Done (sheet call sites).
    /// FALSE = pushed onto an existing stack; that stack owns the bar/back chevron.
    var embedInNavigationStack: Bool = true
    /// DEBUG screenshot loop only: auto-open this spec field's provenance sheet on
    /// load (deterministic capture of the drill state, no fragile sim-tapping).
    var debugOpenField: String? = nil
    @Environment(\.dismiss) private var dismiss

    @State private var vehicle: VehicleHeaderRow?
    @State private var specs: [VehicleSpec] = []   // get_vehicle_specs: fact vs facade
    @State private var valuation: VehicleValuation?  // get_vehicle_valuation: comp-based estimate + basis
    @State private var images: [VehicleGalleryImage] = []
    @State private var loadingMore = false         // a gallery page is in flight
    @State private var reachedEnd = false          // last page returned < pageSize
    @State private var renderingShare = false      // share card is composing
    @State private var debugCard: UIImage?         // DEBUG: render the card on-screen to verify it
    @State private var days: [DayRecord] = []      // the build's rhythm (get_vehicle_contribution_days)
    @State private var sales: [Sale] = []          // real sale history (deduped), each → its listing
    @State private var salesError = false
    @State private var pulse: VehiclePulse?        // live arbitrated signal (vehicle_pulse, Realtime)
    @State private var pulseChannel: RealtimeChannelV2?
    @State private var bookendBefore: VehicleGalleryImage?   // earliest dated frame
    @State private var bookendAfter: VehicleGalleryImage?    // latest dated frame
    @State private var relationship: VehicleRelationship?   // ASSET window (owner-scoped)
    @State private var loadError: String?
    @State private var loaded = false
    // Per-section failure flags — a failed enrichment load must read as "couldn't
    // load · retry", never as a silently-absent (empty) section (Worklight).
    @State private var specsError = false
    @State private var galleryError = false
    @State private var valuationError = false
    @State private var daysError = false
    // ENGAGEMENT — the unified interaction grammar (record_interaction /
    // get_vehicle_engagement): the visitor's job is to contribute, every action a
    // typed observation. v1 rungs: follow (signal) + comment (testimony).
    @State private var engagement: VehicleEngagement?
    @State private var engagementError = false
    @State private var commentDraft = ""
    @State private var posting = false
    @State private var followBusy = false
    @State private var showComments = false   // the comment thread lives in a summoned sheet
    // CONTRIBUTE — the user's job: fill what the record needs. The unverified (facade)
    // specs ARE the needs (data-driven, no hardcoded "what matters"); a signed-in user
    // contributes a value → record_interaction(kind=specification) → testimony.
    @State private var contributeField: VehicleSpec?
    @State private var contributeText = ""
    @State private var contributing = false
    @State private var contributed: Set<String> = []   // optimistic: fields just submitted
    @State private var galleryOpen = false
    @State private var selectedPhoto: VehicleGalleryImage?  // photo→analysis drill
    @State private var viewerStart: GalleryStart?           // grid tap → swipeable Photos-style viewer
    @State private var pendingAnalyze: VehicleGalleryImage? // viewer "Analysis" → atoms after dismiss
    @State private var provenanceDrill: SpecDrill?          // spec value → its source
    @State private var cohortTarget: CohortDrill?           // identity chip → its market cohort

    init(vehicleId: String, embedInNavigationStack: Bool = true, debugOpenField: String? = nil) {
        self.vehicleId = vehicleId
        self.embedInNavigationStack = embedInNavigationStack
        self.debugOpenField = debugOpenField
    }

    var body: some View {
        // Two shells around one scrolling body: a sheet brings its own stack +
        // Done; a push lets the host stack own the bar.
        Group {
            if embedInNavigationStack {
                NavigationStack {
                    content
                        .navigationTitle("Vehicle")
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .topBarLeading) {
                                Button("Done") { dismiss() }
                            }
                            ToolbarItem(placement: .topBarTrailing) { shareButton }
                        }
                        // This sheet owns its stack, so register the vehicle
                        // destination here too — a cohort comp row drills to that
                        // vehicle (vehicle → cohort → comp → its cohort → …).
                        .navigationDestination(for: VehicleHeaderRow.self) { v in
                            VehicleDetailView(vehicleId: v.id.uuidString.lowercased(),
                                              embedInNavigationStack: false)
                        }
                }
            } else {
                content
                    .navigationTitle("Vehicle")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) { shareButton }
                    }
            }
        }
        .task(id: vehicleId) { await load() }
        .task(id: vehicleId) { await loadSpecs() }
        .task(id: vehicleId) { await loadValuation() }
        .task(id: vehicleId) { await loadVehicleDays() }
        .task(id: vehicleId) { await loadSaleHistory() }
        .task(id: vehicleId) { await subscribePulse() }
        .task(id: vehicleId) { await loadBookends() }
        .task(id: vehicleId) { await loadEngagement() }
        .sheet(item: $provenanceDrill) { drill in
            FieldProvenanceSheet(vehicleId: vehicleId, drill: drill)
        }
        .sheet(isPresented: $showComments) {
            CommentsSheet(engagement: engagement,
                          commentDraft: $commentDraft, posting: $posting,
                          onPost: { await postComment() })
        }
        .fullScreenCover(isPresented: $galleryOpen) {
            FullScreenGalleryView(images: galleryURLs)
        }
        // Photo→analysis drill: open the tapped image's vision atoms +
        // provenance. Reuses the shared AnalyzedEvidenceView so there's one
        // analysis surface, not a parallel one. Atoms parsed from the row's
        // labels; an unanalyzed image shows "Analysis pending" with a path,
        // never fabricated atoms.
        .fullScreenCover(item: $selectedPhoto) { img in
            AnalyzedEvidenceView(photo: analyzedPhoto(from: img))
        }
        // The Photos-style swipeable viewer over the loaded build photos. Its "Analysis"
        // action routes to the SAME AnalyzedEvidenceView (after the viewer closes) so the
        // atom drill survives — one analysis surface, reachable from any swiped photo.
        .fullScreenCover(item: $viewerStart, onDismiss: {
            if let p = pendingAnalyze { pendingAnalyze = nil; selectedPhoto = p }
        }) { start in
            FullScreenGalleryView(photos: images, startIndex: start.index,
                                  onAnalyze: { img in pendingAnalyze = img; viewerStart = nil })
        }
        #if DEBUG
        // Verify the rendered share card on-screen (NUKE_DEBUG_SHARECARD=1) — proves
        // the ImageRenderer output (no blank wells) without going through the share sheet.
        .task(id: loaded) {
            if loaded, debugCard == nil,
               ProcessInfo.processInfo.environment["NUKE_DEBUG_SHARECARD"] == "1" {
                debugCard = await buildShareCard()
            }
        }
        .overlay {
            if let c = debugCard {
                Color.black.ignoresSafeArea()
                    .overlay { Image(uiImage: c).resizable().scaledToFit().padding(8) }
            }
        }
        // Screenshot loop: open the Photos-style viewer once the gallery loads.
        .onChange(of: images.count) { _, n in
            if n > 0, viewerStart == nil,
               ProcessInfo.processInfo.environment["NUKE_DEBUG_VIEWER"] == "1" {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { viewerStart = GalleryStart(index: 0) }
            }
        }
        #endif
    }

    /// Build an AnalyzedPhoto (the shared evidence-view model) from a gallery
    /// row. Parses the 'scene:'/'phase:'/'intent:' label facets the BYOK vision
    /// pipeline writes; everything else becomes a component. Real atoms only —
    /// when labels are empty the evidence view renders "Analysis pending".
    private func analyzedPhoto(from img: VehicleGalleryImage) -> AnalyzedPhoto {
        let labels = img.labels ?? []
        func facet(_ prefix: String) -> String? {
            labels.first { $0.hasPrefix(prefix) }.map { String($0.dropFirst(prefix.count)) }
        }
        let components = labels.filter {
            !$0.hasPrefix("scene:") && !$0.hasPrefix("phase:") && !$0.hasPrefix("intent:")
        }
        return AnalyzedPhoto(
            id: img.id,
            url: img.image_url,
            thumb: img.thumbnail_url ?? img.image_url,
            vehicle_id: UUID(uuidString: vehicleId),
            taken_at: img.taken_at,
            file_name: nil,
            scene: facet("scene:"),
            phase: facet("phase:"),
            intent: facet("intent:"),
            components: components.isEmpty ? nil : components,
            analyzed_at: nil,
            analyzed_by: nil
        )
    }

    // ─── Scrolling build sheet ───────────────────────────────────────────────
    // The narrative spine — the record told as a story (hero → worth → proof →
    // photos), with the technical reference demoted below it. Not a ledger of
    // stacked sections; the build, top to bottom.
    // The identity drill, gated on REALITY: returns an action only when the
    // make+model+year triple exists (CohortTerminalView needs all three, and the
    // cohort node is only real then). Missing any → nil → chips render flat, never
    // a tappable-looking dead end (the cardinal no-fake-affordance rule).
    private func cohortDrillAction() -> (() -> Void)? {
        guard let v = vehicle,
              let mk = v.make, !mk.isEmpty,
              let md = v.model, !md.isEmpty,
              let yr = v.year else { return nil }
        return { cohortTarget = CohortDrill(make: mk, model: md, year: yr) }
    }

    private var content: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    // Scroll-offset probe for the BaT sticky header — reports the top's
                    // position in the "vdscroll" space; goes negative as the hero scrolls up.
                    GeometryReader { geo in
                        Color.clear.preference(key: VDScrollKey.self,
                                               value: geo.frame(in: .named("vdscroll")).minY)
                    }
                    .frame(height: 0)
                    BuildStoryHero(
                        imageURL: heroImage?.image_url ?? vehicle?.primary_image_url,
                        year: vehicle?.year, make: vehicle?.make,
                        model: vehicle?.model, trim: vehicle?.trim,
                        takenAt: heroImage?.taken_at,
                        loaded: loaded,
                        onTap: { if let h = heroImage { selectedPhoto = h } else { galleryOpen = true } },
                        onDrillCohort: cohortDrillAction()
                    )
                    loadState            // loading / error (only while the header is absent)
                    liveAuctionBanner    // LIVE — server-arbitrated bid + countdown (only when live)
                    buildInstrument      // ONE instrument: the build barcode (collapsed) ⇄ the
                                         // calendar (expanded). The labor story leads (per Skylar).
                    heroActionRow        // social action row — Follow + comment bubble/count → sheet
                    valuationSection.id("worth")     // WORTH — modeled estimate (blocked when not defensible)
                    saleHistorySection.id("sales")   // SALE HISTORY — the real transacted record (deduped)
                    beforeAfterSection   // THE BUILD — how far it came (earliest → latest frame)
                    ValueTrajectoryView(vehicleId: vehicleId).id("trajectory")  // VALUE BUILT — accrual curve
                    if vehicle != nil {
                        InvestmentProofView(vehicleId: vehicleId).id("proof")   // PROOF — dollars in
                    }
                    photoStrip           // the photos (each → its analysis)
                    assetWindow.id("asset")          // ASSET: his relationship/provenance
                    specTable.id("specs")            // TECHNICAL reference — demoted below the story
                    webCTA
                    Spacer(minLength: 0)
                }
            }
            .background(pageBackground.ignoresSafeArea())
            .coordinateSpace(name: "vdscroll")
            .onPreferenceChange(VDScrollKey.self) { y in
                let c = y < -220   // hero (~240pt) has scrolled past the top
                if c != collapsed { withAnimation(.snappy(duration: 0.2)) { collapsed = c } }
            }
            .overlay(alignment: .top) { stickyHeader }
            // Identity chip → the vehicle's market cohort, PUSHED (native back
            // chevron) so it's part of the navigable system, not a dead-end sheet.
            .navigationDestination(item: $cohortTarget) { c in
                CohortTerminalView(make: c.make, model: c.model, year: c.year)
            }
            #if DEBUG
            // Screenshot loop only: NUKE_DEBUG_SCROLL_TO=worth|proof|asset|specs lands
            // the capture on a below-fold section deterministically (cliclick drag
            // can't drive this ScrollView). Never ships behavior — DEBUG-gated.
            .onChange(of: loaded) { _, done in
                guard done else { return }
                // Force the collapsed living header for deterministic capture.
                if ProcessInfo.processInfo.environment["NUKE_DEBUG_COLLAPSED"] == "1" {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                        withAnimation { collapsed = true }
                    }
                }
                if let target = debugScrollTarget {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2.8) {  // let async sections fetch first
                        withAnimation { proxy.scrollTo(target, anchor: .top) }
                    }
                }
                // Screenshot loop: auto-push the cohort to verify the back chevron.
                if ProcessInfo.processInfo.environment["NUKE_DEBUG_PUSH_COHORT"] == "1" {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { cohortDrillAction()?() }
                }
            }
            #endif
        }
    }

    #if DEBUG
    private var debugScrollTarget: String? {
        ProcessInfo.processInfo.environment["NUKE_DEBUG_SCROLL_TO"]
    }
    #endif

    // Page background — the grouped grey that makes the data sections read as stock
    // inset cards (the Settings / Photos-info idiom) instead of flat text on white.
    // Hero, barcode and the photo grid keep their full-bleed; only the cards float.
    private var pageBackground: Color { Color(.systemGroupedBackground) }

    // ─── Hero — sized render thumb (NOT the raw original), tap → full gallery.
    // The hero is a 240pt strip, not a full-screen view, so it must NOT load the
    // raw object url: measured, that was a 2.9 MB decode on the main thread per
    // appear. width=1000 keeps it crisp full-bleed at ~60 KB. Full-res lives
    // only in the full-screen gallery (tap the hero to get there).
    /// The hero's backing image ROW (not just a url) so the lead can drill into
    /// the data that made it — its analysis cascade — and carry its date (decay).
    /// The single source of truth for the hero — both the image AND its date badge
    /// read from this, so they can never disagree. The hero is the LATEST owner photo
    /// (a build's current state — the lead-is-latest rule). is_primary is deliberately
    /// NOT the lead here: the pipeline keeps resetting it to an older frame (observed
    /// stuck on a May photo while June work exists), which is exactly the staleness
    /// this view exists to kill.
    private var heroImage: VehicleGalleryImage? {
        images.max { ($0.taken_at ?? "") < ($1.taken_at ?? "") }
            ?? images.first
    }


    // ─── Load state — only while the header is absent (the title now lives in
    // the hero title card, so this carries just loading/error).
    @ViewBuilder private var loadState: some View {
        if vehicle == nil {
            Group {
                if let loadError {
                    // The page spine failed — one Retry recovers header+gallery+ASSET.
                    VStack(alignment: .leading, spacing: 10) {
                        Label(loadError, systemImage: "wifi.exclamationmark")
                            .font(.footnote).foregroundStyle(.secondary)
                        Button("Retry") { Task { await load() } }
                            .font(.footnote)
                    }
                } else {
                    HStack(spacing: 8) {
                        ProgressView()
                        Text("Loading…").font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 16)
        }
    }

    // ─── ASSET window — the viewer's real relationship to this vehicle.
    // His ownership/provenance: is it his, what role, title-verified, since
    // when. Sourced from vehicle_user_permissions + ownership_verifications
    // (the same tables the web reads). Renders ONLY when an active permission
    // exists for the signed-in viewer — a vehicle that isn't his shows nothing
    // here, never a false ownership claim (tenet 5 / C0). The title-verified
    // rung lights ONLY on an approved verification; expired/pending read
    // honestly. Each row is a flat record line, structure not color.
    @ViewBuilder private var assetWindow: some View {
        if let rel = relationship {
            VStack(alignment: .leading, spacing: 0) {
                Text("ASSET")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .padding(.bottom, 4)

                // Role — his relationship to the asset (owner / co-owner / …).
                LabeledContent {
                    Text(rel.role.replacingOccurrences(of: "_", with: " ").capitalized)
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundStyle(.primary)
                } label: {
                    Text("Your role").font(.footnote).foregroundStyle(.secondary)
                }
                .padding(.vertical, 5)
                Divider()

                // Title-verified rung — honest about the verification state.
                LabeledContent {
                    if rel.titleVerified {
                        Label("Title-verified", systemImage: "checkmark.seal.fill")
                            .font(.system(.footnote, design: .monospaced))
                            .foregroundStyle(.green)
                    } else if let vs = rel.verificationStatus {
                        // A verification exists but isn't approved — say so.
                        Text("Title \(vs)")
                            .font(.system(.footnote, design: .monospaced))
                            .foregroundStyle(.secondary)
                    } else {
                        Text("Not title-verified")
                            .font(.system(.footnote, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                } label: {
                    Text("Verification").font(.footnote).foregroundStyle(.secondary)
                }
                .padding(.vertical, 5)

                // Since when — granted_at (verified date when present).
                if let since = rel.verifiedAt ?? rel.since {
                    Divider()
                    LabeledContent {
                        Text(since)
                            .font(.system(.footnote, design: .monospaced))
                            .foregroundStyle(.primary)
                    } label: {
                        Text(rel.verifiedAt != nil ? "Verified" : "Since")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 5)
                }
            }
            .nukeCard()
        }
    }

    // ─── Spec table — driven by get_vehicle_specs, which marks each value a FACT
    // (rooted: a real atom — a source photo, a field-keyed observation, or real
    // extraction evidence backs it) or a FACADE (a bare column carrying only a
    // source LABEL, e.g. a color copied off a comp's BaT listing, with nothing
    // beneath it). Facts render in ink and DRILL to their source; facades render
    // dimmed and "unverified" and never pretend to be fact. The root-system
    // contract, on the surface. Long-press any value to copy it.
    @ViewBuilder private var specTable: some View {
        if !specs.isEmpty || locationRow != nil {
            VStack(alignment: .leading, spacing: 0) {
                Text("SPECIFICATIONS")
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .padding(.bottom, 4)

                VStack(spacing: 0) {
                    ForEach(specs) { specRow($0) }
                    if let loc = locationRow { plainRow("Location", loc) }
                }

                // WHAT THIS NEEDS — the unverified specs are the gaps; a signed-in
                // user fills them (the contribution rung of engagement). Data-driven:
                // the spec RPC decides fact-vs-facade, not a hardcoded "what matters".
                if SupabaseService.currentUserId != nil, !needsToFill.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("HELP COMPLETE THIS RECORD")
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(.secondary)
                        FlowChips(items: needsToFill.map(\.label))
                            { idx in contributeField = needsToFill[idx]; contributeText = "" }
                    }
                    .padding(.top, 14)
                }
            }
            .nukeCard()
            // Sheet on THIS subview (not the top-level view) — avoids stacking a 3rd
            // .sheet on the view that already hosts provenance + comments.
            .sheet(item: $contributeField) { spec in contributeSheet(spec) }
        } else if specsError {
            sectionError("specifications") { Task { await loadSpecs() } }
        }
    }

    /// The record's gaps = unverified specs not just submitted (optimistic).
    private var needsToFill: [VehicleSpec] {
        specs.filter { !$0.rooted && !contributed.contains($0.field) }
    }

    @ViewBuilder private func contributeSheet(_ spec: VehicleSpec) -> some View {
        NavigationStack {
            Form {
                Section {
                    TextField(spec.label, text: $contributeText)
                        .autocorrectionDisabled()
                } header: {
                    Text("What's the \(spec.label.lowercased())?")
                } footer: {
                    Text("Your entry is recorded as your testimony — it's reviewed and rooted to you, never silently overwriting the record.")
                }
            }
            .navigationTitle("Add \(spec.label)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Cancel") { contributeField = nil } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Submit") { Task { await contributeSpec(spec) } }
                        .disabled(contributing || contributeText.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .presentationDetents([.height(220)])
    }

    private func contributeSpec(_ spec: VehicleSpec) async {
        let value = contributeText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        contributing = true
        defer { contributing = false }
        struct P: Encodable {
            let p_kind = "specification"; let p_target_type = "vehicle"
            let p_target_id: String; let p_payload: [String: String]
        }
        do {
            _ = try await SupabaseService.client
                .rpc("record_interaction",
                     params: P(p_target_id: vehicleId, p_payload: ["field": spec.field, "value": value]))
                .execute()
            contributed.insert(spec.field)   // optimistic — drops the chip
            contributeField = nil
        } catch {
            NSLog("NukeCapture contribute spec failed: %@", String(describing: error))
        }
    }

    private var locationRow: String? { vehicle.flatMap { location($0) } }

    /// A compact, honest "this section didn't load" row with a retry — for the
    /// stacked enrichment sections on the vehicle page, where a full-screen
    /// ContentUnavailableView would be too heavy. Never let a failed section read
    /// as a silently-absent one (Worklight).
    @ViewBuilder private func sectionError(_ what: String, retry: @escaping () -> Void) -> some View {
        HStack(spacing: 8) {
            Label("Couldn't load \(what)", systemImage: "wifi.exclamationmark")
                .font(.system(.caption2, design: .monospaced))
                .foregroundStyle(.secondary)
            Spacer()
            Button("Retry", action: retry)
                .font(.caption2)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 16)
    }

    // ─── Market estimate — the comp-based model value with its BASIS on the
    // surface (the pencil microline), never a bare number. Labeled "est" because
    // it's modeled, not a fact; flagged stale when the run is old; renders nothing
    // when the asset was never modeled (honest blank, not a facade).
    // Worth as a BRACKET (low · mid · high) + basis, through the shared component —
    // never a bare scalar posing as a price. Renders nothing without a value.
    @ViewBuilder private var valuationSection: some View {
        if let v = valuation, let val = v.value, val > 0 {
            WorthBracketView(valuation: v, make: vehicle?.make, model: vehicle?.model,
                             year: vehicle?.year, excludeId: vehicleId)
                .nukeCard()
        } else if valuationError {
            sectionError("the estimate") { Task { await loadValuation() } }
        }
    }

    private func money0(_ v: Double) -> String {
        v.formatted(.currency(code: "USD").precision(.fractionLength(0)))
    }

    /// One spec row — now the shared rooted-atom primitive. A rooted fact is
    /// ATTRIBUTED (sourced to a real observation, drillable to it); an unrooted
    /// value is a FACADE (dim, "unverified", refuses the tap). Same grammar every
    /// value in the app will speak. (rooted→.proven later, once the spec RPC can
    /// tell owner-confirmed from merely-sourced.)
    @ViewBuilder private func specRow(_ s: VehicleSpec) -> some View {
        RootedValueView(
            label: s.label,
            value: s.value ?? "",
            status: s.rooted ? .attributed : .facade,
            onDrill: s.rooted
                ? { provenanceDrill = SpecDrill(label: s.label, value: s.value ?? "", field: s.field) }
                : nil
        )
        Divider()
    }

    @ViewBuilder private func plainRow(_ label: String, _ value: String) -> some View {
        LabeledContent {
            Text(value).font(.system(.footnote, design: .monospaced))
                .foregroundStyle(.primary).multilineTextAlignment(.trailing)
        } label: {
            Text(label).font(.footnote).foregroundStyle(.secondary)
        }
        .padding(.vertical, 5)
    }

    /// Share = the build STORY as a card, not just a link. Composes hero + title +
    /// worth + a photo strip into a shareable image and presents it alongside the
    /// URL. Presented imperatively (UIActivityViewController) to avoid stacking a
    /// second SwiftUI .sheet on this view (it already hosts the provenance sheet).
    @ViewBuilder private var shareButton: some View {
        Button { shareRecord() } label: {
            if renderingShare { ProgressView() }
            else { Image(systemName: "square.and.arrow.up") }
        }
        .disabled(renderingShare)
    }

    /// Compose the shareable card (image + the nuke.ag URL) and present the sheet.
    /// Fired by the nav-bar share button.
    private func shareRecord() {
        guard !renderingShare else { return }
        Task {
            renderingShare = true
            let card = await buildShareCard()
            renderingShare = false
            var items: [Any] = []
            if let card { items.append(card) }
            if let url = URL(string: "https://nuke.ag/vehicle/\(vehicleId)") { items.append(url) }
            presentShare(items)
        }
    }

    /// Pre-decode the hero + up to 3 strip photos (ImageRenderer won't await async
    /// loads), then render the card. Returns nil → caller shares the URL alone.
    @MainActor private func buildShareCard() async -> UIImage? {
        // Match the on-screen hero (latest frame), not the drift-prone primary_image_url,
        // so the shared card shows the build's current state.
        let heroURL = NukeImage.thumb(heroImage?.image_url ?? vehicle?.primary_image_url, width: 1200)
        let hero = heroURL == nil ? nil : await RemoteImageCache.shared.image(heroURL!)
        var strip: [UIImage] = []
        for img in images where strip.count < 3 {
            if let u = NukeImage.thumb(img.image_url, width: 500),
               let d = await RemoteImageCache.shared.image(u) { strip.append(d) }
        }
        guard hero != nil || !strip.isEmpty else { return nil }   // nothing to show → URL only
        return renderShareCard(hero: hero, title: vehicle?.title ?? "", valuation: valuation,
                               strip: strip, days: days, vehicleId: vehicleId)
    }

    private func presentShare(_ items: [Any]) {
        guard !items.isEmpty,
              let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first,
              let root = scene.keyWindow?.rootViewController else { return }
        let avc = UIActivityViewController(activityItems: items, applicationActivities: nil)
        avc.popoverPresentationController?.sourceView = root.view   // iPad anchor
        avc.popoverPresentationController?.sourceRect = CGRect(x: root.view.bounds.midX,
                                                               y: root.view.bounds.midY,
                                                               width: 0, height: 0)
        (root.presentedViewController ?? root).present(avc, animated: true)
    }

    /// Full-screen gallery list: every loaded photo, or the hero alone as a
    /// fallback so tapping the hero never opens an empty gallery.
    private var galleryURLs: [String] {
        let urls = images.compactMap { $0.image_url }
        if !urls.isEmpty { return urls }
        if let primary = vehicle?.primary_image_url { return [primary] }
        return []
    }

    private func location(_ v: VehicleHeaderRow) -> String? {
        let parts = [v.city, v.state].compactMap { $0?.isEmpty == false ? $0 : nil }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }

    // ─── Photos — a CONTINUOUS grid, not a strip + "view all" dead-end. The full
    // set streams in as you scroll (loadGalleryPage fires off the tail cell), so
    // there's no cap and nowhere to "go". Each cell taps into ITS analysis (vision
    // atoms + provenance) — the image is a window into the data that made it.
    private let galleryColumns = [GridItem(.flexible(), spacing: 2),
                                  GridItem(.flexible(), spacing: 2),
                                  GridItem(.flexible(), spacing: 2)]

    // ─── The build in two frames — earliest vs latest by capture date. Honest
    // bookends only; suppressed unless two distinct dated frames exist.
    // LIVE AUCTION — the BaT-style living instrument, driven by the server-arbitrated
    // vehicle_pulse. Shows ONLY when the arbiter reports a live auction (never faked); a
    // pulsing LIVE dot, the current bid, and a countdown derived client-side from ends_at
    // (TimelineView ticks it smoothly; turns red under 30s). A real new bid chimes (applyPulse).
    @ViewBuilder private var liveAuctionBanner: some View {
        if let p = pulse, p.is_live {
            TimelineView(.periodic(from: .now, by: 1)) { ctx in
                let secs = p.endsAtDate.map { Int(max(0, $0.timeIntervalSince(ctx.date))) }
                HStack(spacing: 8) {
                    Circle().fill(.red).frame(width: 8, height: 8)
                        .opacity(Int(ctx.date.timeIntervalSinceReferenceDate) % 2 == 0 ? 1 : 0.35)
                    Text("LIVE").font(.caption2.weight(.heavy)).foregroundStyle(.red)
                    Text(p.headline_label ?? "Current Bid").font(.caption2).foregroundStyle(.secondary)
                    Text(p.headline_amount.map { money0($0) } ?? "—")
                        .font(.title3.weight(.bold)).monospacedDigit()
                    Spacer(minLength: 8)
                    if let s = secs {
                        HStack(spacing: 4) {
                            Image(systemName: "timer")
                            Text("\(s / 60):\(String(format: "%02d", s % 60))").monospacedDigit()
                        }
                        .font(.headline.weight(.semibold))
                        .foregroundStyle(s <= 30 ? .red : .primary)
                    }
                }
                .padding(.horizontal, 16).padding(.vertical, 12)
                .background(Color.red.opacity(0.06))
                .overlay(alignment: .bottom) { Divider() }
            }
        }
    }

    // SALE HISTORY — the real transacted record, deduped so duplicate ingest rows of the
    // SAME sale don't read as "sold twice". Money leads (mono); each row drills to its
    // source listing. Honest absence: no sales + no error → no section, never a fake row.
    @ViewBuilder private var saleHistorySection: some View {
        if !sales.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                Text(sales.count == 1 ? "SALE HISTORY" : "SALE HISTORY · \(sales.count)")
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    .foregroundStyle(.secondary).padding(.horizontal, 16).padding(.bottom, 6)
                VStack(spacing: 0) { ForEach(sales) { s in saleRow(s) } }
                    .background(Color(.secondarySystemGroupedBackground),
                                in: RoundedRectangle(cornerRadius: 12))
                    .padding(.horizontal, 16)
            }
            .padding(.bottom, 16)
        } else if salesError {
            sectionError("the sale history") { Task { await loadSaleHistory() } }
        }
    }

    @ViewBuilder private func saleRow(_ s: Sale) -> some View {
        let body = HStack(alignment: .firstTextBaseline, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(s.price.map { money0($0) } ?? "Sold")
                    .font(.system(.body, design: .monospaced).weight(.semibold))
                HStack(spacing: 6) {
                    if let p = s.platform {
                        Text(prettySaleSource(p).uppercased())
                            .font(.system(size: 10, design: .monospaced)).foregroundStyle(.secondary)
                    }
                    if let d = s.date {
                        Text(String(d.prefix(10)))
                            .font(.system(size: 10, design: .monospaced)).foregroundStyle(.tertiary)
                    }
                    if let b = s.bids, b > 0 {
                        Text("· \(b) bids")
                            .font(.system(size: 10, design: .monospaced)).foregroundStyle(.tertiary)
                    }
                }
            }
            Spacer(minLength: 0)
            if s.url != nil {
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 11, weight: .semibold)).foregroundStyle(.tertiary)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 11).contentShape(Rectangle())

        if let u = s.url, let url = URL(string: u) {
            Link(destination: url) { body }.buttonStyle(.plain)   // drills to the listing
        } else {
            body                                                   // honest non-link (no source)
        }
        Divider().padding(.leading, 14)
    }

    private func prettySaleSource(_ s: String) -> String {
        switch s.lowercased() {
        case "bat", "bringatrailer": return "Bring a Trailer"
        case "mecum": return "Mecum"
        case "barrettjackson": return "Barrett-Jackson"
        case "gaa-classic-cars": return "GAA"
        case "classiccars.com": return "ClassicCars"
        default: return s.capitalized
        }
    }

    @ViewBuilder private var beforeAfterSection: some View {
        if let b = bookendBefore, let a = bookendAfter {
            BeforeAfterPair(before: b, after: a) { selectedPhoto = $0 }
        }
    }

    // ─── The build instrument — ONE thing, two states. Collapsed it is the 1-D
    // barcode (the build's rhythm); tapping it expands the same data into the 2-D
    // calendar. No origin code and no share button here: the nav bar already shares,
    // and the traceable fingerprint (code + QR) lives where it matters — baked into
    // the shared card. In-app this is just the instrument.
    @State private var timelineExpanded = false

    /// "ACTIVITY · 2 days over 6 yr" — leads the collapsed strip with meaning so a
    /// sparse band reads as a fact, not a broken instrument.
    private var buildSpanLabel: String {
        let eps = days.compactMap { BuildBarcode.epochDay($0.day) }
        guard let lo = eps.min(), let hi = eps.max() else { return "ACTIVITY" }
        let span = hi - lo
        let s = span >= 365 ? "\(span / 365) yr" : span >= 30 ? "\(span / 30) mo"
              : span > 0 ? "\(span) days" : "1 day"
        return "ACTIVITY · \(days.count) \(days.count == 1 ? "day" : "days") over \(s)"
    }

    @ViewBuilder private var buildInstrument: some View {
        // A build barcode is the wrong instrument for a scraped comp (its days are
        // event-only ingest dumps, not owner work) — it collapses to one cryptic cell.
        // Show it only when there's a real BUILD signal (work logged, or real photo
        // activity); otherwise the SALE HISTORY above is the honest spine.
        if !days.isEmpty && days.contains(where: { $0.work > 0 || $0.photos > 1 }) {
            VStack(alignment: .leading, spacing: 6) {
                if timelineExpanded {
                    HStack {
                        Spacer()
                        Button { withAnimation(.snappy(duration: 0.22)) { timelineExpanded = false } } label: {
                            Image(systemName: "chevron.up")
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 16)
                    BarcodeTimeline(days: days) { day in
                        if let match = images.first(where: {
                            ($0.taken_at?.prefix(10)).map(String.init) == day.day
                        }) { selectedPhoto = match }
                    }
                    .transition(.opacity)
                } else {
                    // Headline the strip so a sparse band reads as a true fact, not a
                    // glitch (lead with meaning, per the Fitness pattern).
                    Text(buildSpanLabel)
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 16)
                    // The spine: edge-to-edge, full-bleed, on the SHARED surface.
                    // Density reads by filled-green vs faint-empty (no foreign field
                    // to fight light/dark/colorway). Tap → the timeline (the nav).
                    ZStack(alignment: .trailing) {
                        BuildBarcode(days: days, height: 26)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                            .padding(.horizontal, 16)
                        Image(systemName: "chevron.down")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(.secondary)
                            .padding(.trailing, 12)
                    }
                    .contentShape(Rectangle())
                    .onTapGesture { withAnimation(.snappy(duration: 0.22)) { timelineExpanded = true } }
                    .transition(.opacity)
                }
            }
            .padding(.bottom, 16)
        } else if daysError {
            sectionError("the build timeline") { Task { await loadVehicleDays() } }
        }
    }

    // ─── BaT-style sticky header — once the hero scrolls away, the identity
    // compresses into a pinned bar: name · barcode · worth. Driven by `collapsed`,
    // set from the scroll-offset probe at the top of `content`.
    @State private var collapsed = false

    struct VDScrollKey: PreferenceKey {
        static var defaultValue: CGFloat = 0
        static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
    }

    // ─── The LIVING header. Once the hero scrolls away, the identity compresses
    // into a pinned glass bar that keeps the vehicle's vital signs in view while
    // the user browses its images: name · barcode sliver · the activity PULSE
    // (weighed-in · following · contributions · est). The pulse is typed signals
    // (VehiclePulse) — only signals with REAL backing data render; viewers/bids are
    // defined but stay dark until their systems land (the "storm"), never faked.
    @ViewBuilder private var stickyHeader: some View {
        if collapsed, let v = vehicle {
            // Two layers on the SAME glass: the identity line (whole title — NEVER
            // truncated — + pulse), and the full-width barcode SPINE flush beneath.
            // The barcode is the constant thread; it never loses width. No foreign
            // field — empties read faintly on the glass, so it survives mode/colorway.
            VStack(spacing: 5) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(v.title)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    PulseStrip(signals: pulseSignals)
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)

                if !days.isEmpty {
                    BuildBarcode(days: days, height: 13)
                        .frame(maxWidth: .infinity)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 7)
                }
            }
            .frame(maxWidth: .infinity)
            .background(.regularMaterial)
            .overlay(alignment: .bottom) { Divider() }
            .contentShape(Rectangle())
            // Everything is a button: the living bar drills to the thread (the
            // primary live action today). Scroll-to-top can graft on later.
            .onTapGesture { showComments = true }
            .transition(.move(edge: .top).combined(with: .opacity))
        }
    }

    /// The vehicle's vital signs, assembled from REAL engagement + valuation data.
    /// Order = primacy. A signal renders only when its data genuinely exists; the
    /// "storm" signals (viewers/presence, bids/auction) are defined in PulseKind but
    /// not appended until their backing systems exist — wired, dark, never fabricated.
    private var pulseSignals: [PulseSignal] {
        var out: [PulseSignal] = []
        if let e = engagement {
            if e.comment_count > 0 {
                out.append(.init(kind: .weighedIn, text: "\(e.comment_count)"))
            }
            if e.following_count > 0 {
                out.append(.init(kind: .following, text: "\(e.following_count)"))
            }
            if e.contribution_count > 0 {
                out.append(.init(kind: .contributions, text: "\(e.contribution_count)"))
            }
        }
        if let val = valuation, let mid = val.value, mid > 0 {
            out.append(.init(kind: .estimate, text: PulseSignal.shortMoney(mid)))
        }
        // STORM — auction now ROUTED via the server-arbitrated vehicle_pulse. Lights ONLY
        // when the arbiter reports a live auction WITH a real bid; dormant → stays dark.
        // No fabricated number (viewers/presence still dark — no backing system yet).
        if let p = pulse, p.is_live, let bid = p.displayBid {
            out.insert(.init(kind: .bids, text: PulseSignal.shortMoney(bid)), at: 0)  // leads when live
        }
        return out
    }

    // The Photos 'Days' grid: build photos grouped under pinned date headers (the data
    // has 133 distinct days), each a contact-sheet of 1:1 tiles. Tap → the swipeable
    // viewer. Tail-paging + the owner before/after curation are preserved on the tile.
    @ViewBuilder private var photoStrip: some View {
        if !images.isEmpty {
            LazyVStack(alignment: .leading, spacing: 8, pinnedViews: .sectionHeaders) {
                HStack {
                    Text("PHOTOS")
                        .font(.system(.caption2, design: .monospaced)).foregroundStyle(.secondary)
                    Spacer()
                    Text(images.count.formatted() + (reachedEnd ? "" : "+"))
                        .font(.system(.caption2, design: .monospaced)).foregroundStyle(.secondary)
                }
                .padding(.horizontal, 16)

                ForEach(photoDays, id: \.day) { group in
                    Section {
                        LazyVGrid(columns: galleryColumns, spacing: 2) {
                            ForEach(group.photos) { img in photoTile(img) }
                        }
                    } header: {
                        HStack {
                            Text(prettyDay(group.day)).font(.subheadline.weight(.semibold))
                            Spacer()
                            Text("\(group.photos.count)")
                                .font(.system(.caption2, design: .monospaced)).foregroundStyle(.secondary)
                        }
                        .padding(.horizontal, 16).padding(.vertical, 6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.regularMaterial)
                    }
                }

                if loadingMore && !reachedEnd {
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 12)
                }
            }
            .padding(.bottom, 16)
        } else if galleryError {
            sectionError("photos") { Task { await loadGalleryPage(reset: true) } }
        }
    }

    /// `images` (taken_at DESC) grouped into ordered day-clusters — the Photos 'Days' shape.
    private var photoDays: [(day: String, photos: [VehicleGalleryImage])] {
        var order: [String] = []; var map: [String: [VehicleGalleryImage]] = [:]
        for img in images {
            let d = img.taken_at.map { String($0.prefix(10)) } ?? "undated"
            if map[d] == nil { order.append(d) }
            map[d, default: []].append(img)
        }
        return order.map { ($0, map[$0] ?? []) }
    }

    private func prettyDay(_ s: String) -> String {
        guard s != "undated" else { return "Undated" }
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: s) else { return s }
        let out = DateFormatter(); out.dateStyle = .long
        return out.string(from: d)
    }

    @ViewBuilder private func photoTile(_ img: VehicleGalleryImage) -> some View {
        Button {
            viewerStart = GalleryStart(index: images.firstIndex { $0.id == img.id } ?? 0)
        } label: {
            Color(.secondarySystemFill)
                .aspectRatio(1, contentMode: .fit)
                .overlay {
                    CachedAsyncImage(url: NukeImage.thumb(img.image_url, width: 300)) { i in
                        i.resizable().scaledToFill()
                    } placeholder: { Image(systemName: "car.side").foregroundStyle(.secondary) }
                }
                .clipped().contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            if isOwner {
                Button { Task { await setBuildImage(img.id, role: "before_image") } } label: {
                    Label("Set as the 'before' shot", systemImage: "flag.checkered")
                }
                Button { Task { await setBuildImage(img.id, role: "after_image") } } label: {
                    Label("Set as the 'after' shot", systemImage: "flag.checkered.2.crossed")
                }
            }
        }
        .onAppear {
            if img.id == images.last?.id { Task { await loadGalleryPage() } }
        }
    }

    // ─── ENGAGE — the visitor's job, the engagement ladder made real. Every
    // action is a typed interaction through ONE grammar (record_interaction):
    // FOLLOW is signal (→ user_interactions); COMMENT is testimony (→ a kind=comment
    // observation on the spine, authored by the user, trust-weighted). The counts
    // are depth (following · weighed-in · contributions), never hearts.
    // ─── The content-action row, directly under the hero — the slot every social
    // post reserves for the like/comment/share affordances. Follow (signal) + a
    // comment bubble whose live count IS the door to the thread. No "ENGAGE" verb,
    // no section title, no composer standing open in the page spine.
    @ViewBuilder private var heroActionRow: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 18) {
                if let e = engagement {
                    Button { Task { await toggleFollow() } } label: {
                        Label(e.is_following ? "Following" : "Follow",
                              systemImage: e.is_following ? "checkmark" : "plus")
                            .font(.footnote.weight(.medium))
                    }
                    .buttonStyle(.bordered)
                    .disabled(followBusy)

                    Button { showComments = true } label: {
                        Label(e.comment_count > 0 ? "\(e.comment_count)" : "Comment",
                              systemImage: "bubble.left")
                            .font(.footnote.weight(.medium))
                    }
                    .buttonStyle(.plain)

                    Spacer(minLength: 0)
                } else if engagementError {
                    Button("Retry") { Task { await loadEngagement() } }.font(.footnote)
                    Spacer()
                } else {
                    ProgressView().scaleEffect(0.7)
                    Spacer()
                }
            }
            // The depth caption — quiet, never a heading.
            if let e = engagement {
                let caption = engagementCounts(e)
                if !caption.isEmpty {
                    Text(caption).font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 6)
    }

    private func engagementCounts(_ e: VehicleEngagement) -> String {
        var parts: [String] = []
        if e.following_count > 0 { parts.append("\(e.following_count) following") }
        if e.comment_count > 0 { parts.append("\(e.comment_count) weighed in") }
        if e.contribution_count > 0 { parts.append("\(e.contribution_count) contributions") }
        return parts.isEmpty ? "Be the first to weigh in" : parts.joined(separator: " · ")
    }

    private func loadEngagement() async {
        engagementError = false
        do {
            engagement = try await SupabaseService.client
                .rpc("get_vehicle_engagement", params: ["p_vehicle_id": vehicleId])
                .execute()
                .value
        } catch {
            engagementError = true
            NSLog("NukeCapture engagement load failed: %@", String(describing: error))
        }
    }

    private func toggleFollow() async {
        followBusy = true
        defer { followBusy = false }
        do {
            _ = try await SupabaseService.client
                .rpc("record_interaction", params: [
                    "p_kind": "follow", "p_target_type": "vehicle", "p_target_id": vehicleId,
                ])
                .execute()
            await loadEngagement()
        } catch {
            NSLog("NukeCapture follow failed: %@", String(describing: error))
        }
    }

    private func postComment() async {
        let text = commentDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        posting = true
        defer { posting = false }
        struct CommentParams: Encodable {
            let p_kind = "comment"; let p_target_type = "vehicle"
            let p_target_id: String; let p_payload: [String: String]
        }
        do {
            _ = try await SupabaseService.client
                .rpc("record_interaction",
                     params: CommentParams(p_target_id: vehicleId, p_payload: ["text": text]))
                .execute()
            commentDraft = ""
            await loadEngagement()
        } catch {
            NSLog("NukeCapture comment post failed: %@", String(describing: error))
        }
    }

    // ─── CTA — the web profile (verified 200). A plain bordered button, no skin.
    @ViewBuilder private var webCTA: some View {
        if let url = URL(string: "https://nuke.ag/vehicle/\(vehicleId)") {
            Link(destination: url) {
                HStack {
                    Text("Open on nuke.ag")
                    Spacer()
                    Image(systemName: "arrow.up.right.square")
                }
            }
            .buttonStyle(.bordered)
            .padding(.horizontal, 16)
            .padding(.bottom, 24)
        }
    }

    private func load() async {
        do {
            // One select covers header + spec table.
            let rows: [VehicleHeaderRow] = try await SupabaseService.client
                .from("vehicles")
                .select("id,year,make,model,trim,city,state,primary_image_url")
                .eq("id", value: vehicleId)
                .limit(1)
                .execute()
                .value
            vehicle = rows.first
            loadError = rows.first == nil ? "Vehicle not found" : nil
        } catch {
            loadError = "Load failed"
            NSLog("NukeCapture vehicle detail load failed: %@", String(describing: error))
        }
        // Gallery is independent — a load failure here never blocks the spec
        // sheet. First page only; the rest streams in as the grid scrolls.
        await loadGalleryPage(reset: true)
        // ASSET window — the viewer's relationship. Owner-scoped via RLS; a
        // signed-out viewer or a non-owner simply gets no rows → nil → the
        // section doesn't render (no false ownership claim).
        await loadRelationship()
        loaded = true
    }

    private static let galleryPageSize = 60

    /// One page of the gallery, appended to `images`. Continuous scroll: the grid
    /// triggers the next page when its tail appears, so there's no cap and no
    /// "view all" dead-end.
    ///
    /// Two rules, both from Skylar's report (the grid was showing un-analyzed,
    /// cross-vehicle junk in ingest order):
    ///   1. ANALYZED ONLY — `ai_processing_status IN ('completed','analyzed')`. The
    ///      web pipeline marks frames `'completed'`; the iOS capture runner marks them
    ///      `'analyzed'` — both mean "vision has read it", so accept either. Pending/
    ///      processing frames (incl. the doppelganger shop photos not yet attributed)
    ///      don't pollute the profile; they appear once they're understood.
    ///   2. LATEST FIRST — order by `taken_at` desc, not `created_at`. Capture date
    ///      is what "newest" means; ingest order was a jumble.
    /// Both ride the `vehicle_images_taken_date` partial index (vehicle_id, taken_at
    /// WHERE taken_at IS NOT NULL) → backward index scan, ~1ms, no RLS full-sort
    /// timeout.
    ///
    /// NO server count: an exact count over the ~2.6K matching rows under RLS
    /// materializes the whole set and trips statement_timeout (measured: 500 @19s),
    /// and the planner's estimate for this partial-index query is garbage (~65). So
    /// the header shows the honest loaded count (`images.count`) — which becomes the
    /// true total once the tail is reached.
    private func loadGalleryPage(reset: Bool = false) async {
        if loadingMore { return }
        if !reset && reachedEnd { return }
        loadingMore = true
        defer { loadingMore = false }
        galleryError = false
        let from = reset ? 0 : images.count
        let to = from + Self.galleryPageSize - 1
        do {
            let page: [VehicleGalleryImage] = try await SupabaseService.client
                .from("vehicle_images")
                .select("id,image_url,thumbnail_url,is_primary,taken_at,labels,ai_processing_status")
                .eq("vehicle_id", value: vehicleId)
                .in("ai_processing_status", values: ["completed", "analyzed"])
                .not("taken_at", operator: .is, value: "null")
                .not("is_superseded", operator: .is, value: "true")   // keep null/false, drop superseded dupes
                .order("taken_at", ascending: false)
                .range(from: from, to: to)
                .execute()
                .value
            if reset { images = page; reachedEnd = false } else { images.append(contentsOf: page) }
            if page.count < Self.galleryPageSize { reachedEnd = true }
        } catch {
            // Only the FIRST page (empty strip) surfaces as an error; a tail-page
            // failure leaves the populated strip intact (images.isEmpty == false).
            if images.isEmpty { galleryError = true }
            NSLog("NukeCapture vehicle gallery page load failed: %@", String(describing: error))
        }
    }

    /// Load the spec set with rootedness (get_vehicle_specs). Separate from the
    /// header fetch so a slow/failed specs call never blanks the rest of the page.
    private func loadSpecs() async {
        specsError = false
        do {
            let rows: [VehicleSpec] = try await SupabaseService.client
                .rpc("get_vehicle_specs", params: ["p_vehicle_id": vehicleId])
                .execute()
                .value
            specs = rows
            #if DEBUG
            if let f = debugOpenField, let s = specs.first(where: { $0.field == f && $0.rooted }) {
                provenanceDrill = SpecDrill(label: s.label, value: s.value ?? "", field: f)
            }
            #endif
        } catch {
            specsError = true
            NSLog("NukeCapture specs load failed: %@", String(describing: error))
        }
    }

    /// Load the comp-based market estimate + its basis. Null when unmodeled.
    private func loadValuation() async {
        valuationError = false
        do {
            valuation = try await SupabaseService.client
                .rpc("get_vehicle_valuation", params: ["p_vehicle_id": vehicleId])
                .execute()
                .value
        } catch {
            valuationError = true
            NSLog("NukeCapture valuation load failed: %@", String(describing: error))
        }
    }

    /// The build's working days for the timeline — same (day,kind,n) grouping as
    /// the profile (ProfileTab.loadContributionDays). Vehicle-scoped.
    private func loadVehicleDays() async {
        daysError = false
        do {
            let rows: [ContributionRow] = try await SupabaseService.client
                .rpc("get_vehicle_contribution_days", params: ["p_vehicle_id": vehicleId])
                .execute()
                .value
            var byDay: [String: DayRecord] = [:]
            for row in rows {
                var rec = byDay[row.day] ?? DayRecord(day: row.day)
                switch row.kind {
                case "photo": rec.photos += row.n
                case "work":  rec.work += row.n
                default:      rec.events += row.n
                }
                byDay[row.day] = rec
            }
            days = byDay.values.sorted { $0.day > $1.day }
        } catch {
            if days.isEmpty { daysError = true }
            NSLog("NukeCapture vehicle days load failed: %@", String(describing: error))
        }
    }

    /// Real sale events, deduped so duplicate ingest rows of the SAME sale don't read as
    /// "sold twice" (a rendering artifact — the cohort has zero genuine resales). Reads
    /// vehicle_timeline_events directly (RLS off; same table the build-days RPC uses).
    private func loadSaleHistory() async {
        salesError = false
        do {
            let rows: [SaleEventRow] = try await SupabaseService.client
                .from("vehicle_timeline_events")
                .select("id,event_type,event_date,title,metadata")
                .eq("vehicle_id", value: vehicleId)
                .in("event_type", values: ["auction_sold", "listing_sold", "sale", "sold"])
                .order("event_date", ascending: false)
                .execute().value
            var seen = Set<String>(); var out: [Sale] = []
            for r in rows {
                let price = r.metadata?.price; let url = r.metadata?.url
                let key = "\(r.event_date ?? "")|\(price.map { String(Int($0)) } ?? "")|\(url ?? "")"
                guard !seen.contains(key) else { continue }   // collapse duplicate ingest rows
                seen.insert(key)
                out.append(Sale(id: key, date: r.event_date, price: price,
                                platform: r.metadata?.platform, url: url,
                                lot: r.metadata?.lot_number, bids: r.metadata?.bid_count))
            }
            sales = out
        } catch {
            if sales.isEmpty { salesError = true }
            NSLog("NukeCapture sale history load failed: %@", String(describing: error))
        }
    }

    // ─── LIVE PULSE ─────────────────────────────────────────────────────────────
    // Hydrate from the canonical row, then subscribe to its Realtime changes. The header
    // re-headlines off the SAME server-arbitrated row the web reads (WEB_PARITY) — the
    // client never reconciles sources. Reconnect re-hydrates (postgres_changes has no replay).
    private func loadPulse() async {
        let rows: [VehiclePulse]? = try? await SupabaseService.client
            .from("vehicle_pulse").select()
            .eq("vehicle_id", value: vehicleId).limit(1)
            .execute().value
        await applyPulse(rows?.first)
    }

    private func subscribePulse() async {
        await loadPulse()
        let channel = SupabaseService.client.channel("vp-\(vehicleId)")
        await MainActor.run { self.pulseChannel = channel }
        let stream = channel.postgresChange(AnyAction.self, schema: "public",
                                            table: "vehicle_pulse", filter: "vehicle_id=eq.\(vehicleId)")
        await channel.subscribe()
        for await _ in stream { await loadPulse() }   // already-arbitrated truth; refetch the row
    }

    @MainActor private func applyPulse(_ p: VehiclePulse?) {
        let prev = pulse
        pulse = p
        // Chime + haptic ONLY on a real higher live bid — motion is a derivative of data,
        // never theater; never on hydrate/reconnect (prev nil) or a non-increase.
        guard let p, p.is_live, p.live_state == "live",
              let bid = p.displayBid, let was = prev?.displayBid, bid > was else { return }
        AudioServicesPlaySystemSound(1057)
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    /// The build's bookends — earliest + latest frame by capture date. Two 1-row
    /// fetches via the vehicle_images_taken_date index (fast; nulls sort last by
    /// default so LIMIT 1 lands on a real dated frame). Only set when they're two
    /// distinct frames on distinct dates — never a fake before/after.
    /// True when the signed-in viewer owns this vehicle (gates owner-only actions).
    private var isOwner: Bool {
        let r = relationship?.role.lowercased() ?? ""
        return r == "owner" || r == "co_owner"
    }

    /// Owner designates a build frame (before = acquisition shot, after = current
    /// state). THE BUILD is an owner STATEMENT, not a guess: min/max(taken_at)
    /// picked indefensible frames (a 2016 interior shot vs a 2026 VIN data-plate —
    /// the most recent capture session happened to photograph the tag). So both
    /// ends are owner-designated through one generalized RPC.
    private func setBuildImage(_ imageId: UUID, role: String) async {
        struct P: Encodable { let p_vehicle_id: String; let p_image_id: String; let p_role: String }
        do {
            _ = try await SupabaseService.client
                .rpc("set_vehicle_build_image",
                     params: P(p_vehicle_id: vehicleId,
                               p_image_id: imageId.uuidString.lowercased(), p_role: role))
                .execute()
            await loadBookends()
        } catch {
            NSLog("NukeCapture set build image (%@) failed: %@", role, String(describing: error))
        }
    }

    /// The owner-designated image id for a role, if one exists (latest non-superseded
    /// kind=media observation with the matching structured_data.role). EXIF can't be
    /// trusted to pick build frames, so only the owner's pick counts.
    private func ownerDesignatedImageId(role: String) async -> UUID? {
        struct Obs: Decodable { let structured_data: SD; struct SD: Decodable { let image_id: String? } }
        do {
            let rows: [Obs] = try await SupabaseService.client
                .from("vehicle_observations").select("structured_data")
                .eq("vehicle_id", value: vehicleId)
                .eq("kind", value: "media")
                .eq("structured_data->>role", value: role)
                .neq("is_superseded", value: true)
                .order("observed_at", ascending: false)
                .limit(1).execute().value
            if let s = rows.first?.structured_data.image_id { return UUID(uuidString: s) }
        } catch {
            NSLog("NukeCapture %@ designation lookup failed: %@", role, String(describing: error))
        }
        return nil
    }

    /// Fetch one image row by id (for an owner-designated bookend).
    private func image(id: UUID) async -> VehicleGalleryImage? {
        do {
            let rows: [VehicleGalleryImage] = try await SupabaseService.client
                .from("vehicle_images")
                .select("id,image_url,thumbnail_url,is_primary,taken_at,labels,ai_processing_status")
                .eq("id", value: id.uuidString.lowercased())
                .limit(1).execute().value
            return rows.first
        } catch {
            NSLog("NukeCapture bookend image fetch failed: %@", String(describing: error))
            return nil
        }
    }

    /// THE BUILD's two frames — BOTH owner-designated, no auto min/max guess. The
    /// guess produced indefensible pairs (interior vs VIN plate), so the section
    /// shows only when the owner has picked both ends; otherwise it stays hidden
    /// (an honest blank beats a wrong before/after). Owner sets each via the photo
    /// long-press menu.
    private func loadBookends() async {
        async let beforeIdT = ownerDesignatedImageId(role: "before_image")
        async let afterIdT  = ownerDesignatedImageId(role: "after_image")
        let (beforeId, afterId) = await (beforeIdT, afterIdT)
        guard let bId = beforeId, let aId = afterId, bId != aId else {
            bookendBefore = nil; bookendAfter = nil; return
        }
        async let bT = image(id: bId)
        async let aT = image(id: aId)
        let (b, a) = await (bT, aT)
        guard let b, let a else { bookendBefore = nil; bookendAfter = nil; return }
        bookendBefore = b
        bookendAfter = a
    }

    /// Load the viewer's ASSET relationship from the same tables the web reads.
    /// vehicle_user_permissions (role/since) + ownership_verifications (title
    /// rung). RLS scopes both to the signed-in user, so a non-owner gets empty
    /// results and the ASSET window stays hidden. Never claims ownership the
    /// data doesn't support (tenet 5 / C0).
    private func loadRelationship() async {
        // anon: no asset window. The relationship is THIS viewer's, so it must
        // be scoped to the signed-in user id — vehicle_user_permissions is
        // publicly readable, so without the user_id filter a signed-in viewer
        // would see ANOTHER owner's grant and the UI would falsely claim the
        // vehicle is theirs (tenet 5 violation). Scope to currentUserId.
        guard let uid = SupabaseService.currentUserId else { return }
        do {
            let perms: [VehiclePermissionRow] = try await SupabaseService.client
                .from("vehicle_user_permissions")
                .select("role,granted_at,is_active,revoked_at")
                .eq("vehicle_id", value: vehicleId)
                .eq("user_id", value: uid)
                .execute()
                .value
            // Active, non-revoked grants only; prefer 'owner'.
            let active = perms.filter { ($0.is_active ?? true) && $0.revoked_at == nil }
            guard let perm = active.first(where: { $0.role == "owner" }) ?? active.first,
                  let role = perm.role else {
                relationship = nil
                return
            }

            // Title verification rung — approved lights the badge; other states
            // surface honestly.
            let vers: [OwnershipVerificationRow] = try await SupabaseService.client
                .from("ownership_verifications")
                .select("status,approved_at,verification_type,verification_category")
                .eq("vehicle_id", value: vehicleId)
                .eq("user_id", value: uid)
                .execute()
                .value
            let titleVers = vers.filter {
                $0.verification_type == "title" || $0.verification_category == "title_document"
            }
            let approved = titleVers.first { $0.status == "approved" }
            let anyVer = approved ?? titleVers.first

            relationship = VehicleRelationship(
                role: role,
                since: perm.granted_at.map { String($0.prefix(10)) },
                titleVerified: approved != nil,
                verificationStatus: approved == nil ? anyVer?.status : nil,
                verifiedAt: approved?.approved_at.map { String($0.prefix(10)) }
            )
        } catch {
            NSLog("NukeCapture vehicle relationship load failed: %@", String(describing: error))
        }
    }
}

// ─── Full-screen gallery — in-app, full-res originals. A paged TabView; every
// CTA resolves in-app (C10 dead-link rule). Carries its own dismiss.
/// Drives the swipeable viewer's `.fullScreenCover(item:)` — the index to open at.
private struct GalleryStart: Identifiable { let index: Int; var id: Int { index } }

// A real photo viewer (the Photos-app idiom): swipe between, pinch/pan/double-tap zoom,
// a filmstrip scrubber, date caption, cached full-res. Tap toggles chrome. Analysis is
// still one tap away (the drill survives) — never a parallel atom view (don't-mint).
private struct FullScreenGalleryView: View {
    let photos: [VehicleGalleryImage]
    var onAnalyze: ((VehicleGalleryImage) -> Void)? = nil
    @State private var index: Int
    @State private var showChrome = true
    @Environment(\.dismiss) private var dismiss

    init(photos: [VehicleGalleryImage], startIndex: Int = 0,
         onAnalyze: ((VehicleGalleryImage) -> Void)? = nil) {
        self.photos = photos
        self.onAnalyze = onAnalyze
        _index = State(initialValue: min(max(startIndex, 0), max(photos.count - 1, 0)))
    }
    // Legacy shim — the two callers that pass bare URL strings (hero fallback, cohort zoom).
    init(images: [String]) {
        self.init(photos: images.map {
            VehicleGalleryImage(id: UUID(), image_url: $0, thumbnail_url: nil, is_primary: nil,
                                taken_at: nil, labels: nil, ai_processing_status: nil)
        })
    }

    private var current: VehicleGalleryImage? { photos.indices.contains(index) ? photos[index] : nil }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            TabView(selection: $index) {
                ForEach(Array(photos.enumerated()), id: \.offset) { i, img in
                    ZoomableImage(url: img.image_url).tag(i).ignoresSafeArea()
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .onTapGesture { withAnimation(.easeInOut(duration: 0.2)) { showChrome.toggle() } }

            if showChrome {
                VStack(spacing: 0) {
                    HStack {
                        Button { dismiss() } label: {
                            Image(systemName: "xmark").font(.headline.weight(.semibold))
                                .foregroundStyle(.white).padding(10).background(.black.opacity(0.4), in: Circle())
                        }
                        Spacer()
                        if let c = current, onAnalyze != nil {
                            Button { onAnalyze?(c) } label: {
                                Label("Analysis", systemImage: "sparkle.magnifyingglass")
                                    .font(.subheadline.weight(.medium)).foregroundStyle(.white)
                                    .padding(.horizontal, 12).padding(.vertical, 8)
                                    .background(.black.opacity(0.4), in: Capsule())
                            }
                        }
                    }
                    .padding(.horizontal, 16).padding(.top, 8)
                    Spacer()
                    if let at = current?.taken_at, !at.isEmpty {
                        Text(prettyDate(at)).font(.footnote.weight(.medium)).foregroundStyle(.white)
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .background(.black.opacity(0.4), in: Capsule())
                            .padding(.bottom, 6)
                    }
                    scrubber.padding(.bottom, 8)
                }
                .transition(.opacity)
            }
        }
        .statusBarHidden()
    }

    private var scrubber: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) {
                    ForEach(Array(photos.enumerated()), id: \.offset) { i, img in
                        Button { withAnimation(.snappy(duration: 0.2)) { index = i } } label: {
                            CachedAsyncImage(url: NukeImage.thumb(img.image_url, width: 120)) { im in
                                im.resizable().scaledToFill()
                            } placeholder: { Color.white.opacity(0.1) }
                            .frame(width: i == index ? 46 : 34, height: i == index ? 46 : 34)
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                            .overlay(RoundedRectangle(cornerRadius: 4)
                                .strokeBorder(.white, lineWidth: i == index ? 2 : 0))
                            .id(i)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
            }
            .frame(height: 54)
            .onChange(of: index) { _, new in withAnimation { proxy.scrollTo(new, anchor: .center) } }
        }
    }

    private func prettyDate(_ s: String) -> String {
        let iso = ISO8601DateFormatter(); iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let d = iso.date(from: s) ?? {
            let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f.date(from: String(s.prefix(10)))
        }()
        guard let d else { return String(s.prefix(10)) }
        let out = DateFormatter(); out.dateStyle = .long
        return out.string(from: d)
    }
}

// Pinch-to-zoom + pan-while-zoomed + double-tap toggle, clamped 1…4×. Full-res raw
// image (IMAGE RULE), cached. Resets on page change (each page is its own instance).
private struct ZoomableImage: View {
    let url: String?
    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    var body: some View {
        GeometryReader { geo in
            CachedAsyncImage(url: URL(string: url ?? "")) { image in
                image.resizable().scaledToFit()
            } placeholder: {
                Color.black.overlay { ProgressView().tint(.white) }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .scaleEffect(scale)
            .offset(offset)
            .gesture(MagnificationGesture()
                .onChanged { v in scale = min(max(lastScale * v, 1), 4) }
                .onEnded { _ in
                    lastScale = scale
                    if scale <= 1 { withAnimation(.spring) { offset = .zero; lastOffset = .zero } }
                })
            .simultaneousGesture(DragGesture()
                .onChanged { v in
                    if scale > 1 {
                        offset = CGSize(width: lastOffset.width + v.translation.width,
                                        height: lastOffset.height + v.translation.height)
                    }
                }
                .onEnded { _ in lastOffset = offset })
            .onTapGesture(count: 2) {
                withAnimation(.spring) {
                    if scale > 1 { scale = 1; lastScale = 1; offset = .zero; lastOffset = .zero }
                    else { scale = 2.5; lastScale = 2.5 }
                }
            }
        }
    }
}

// ─── VALUE TRAJECTORY ────────────────────────────────────────────────────────
// The thesis: a built car has ONE sale (the purchase) then ACCRUING documented
// investment — value you BUILD over time, not wait for a resale to reveal. Reads
// get_vehicle_investment_timeline (receipts, dated). Undated receipts are summarized
// honestly, never plotted (no date to place them). Headline includes the acquisition
// so the curve total ($33.5K) doesn't look broken next to the parts-only proof ledger.
struct InvestmentTimeline: Decodable {
    let points: [Point]?
    let final_cumulative_dated: Double?
    let total_with_undated: Double?
    let baseline: Point?
    let undated: Undated?
    struct Point: Decodable, Identifiable {
        let date: String?; let kind: String?; let delta: Double?
        let proven: Bool?; let cumulative: Double?
        var id: String { (date ?? "") + (kind ?? "") + String(cumulative ?? 0) }
        var day: Date? {
            guard let s = date else { return nil }
            let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f.date(from: String(s.prefix(10)))
        }
    }
    struct Undated: Decodable { let n: Int?; let total: Double? }
}

struct ValueTrajectoryView: View {
    let vehicleId: String
    @State private var t: InvestmentTimeline?

    private func money(_ v: Double) -> String { v.formatted(.currency(code: "USD").precision(.fractionLength(0))) }
    private func moneyK(_ v: Double) -> String {
        v >= 1000 ? "$\((v/1000).formatted(.number.precision(.fractionLength(v < 10000 ? 1 : 0))))k" : money(v)
    }

    var body: some View {
        Group {
        if let t, let pts = (t.points ?? []).filter({ $0.day != nil && $0.cumulative != nil }) as [InvestmentTimeline.Point]?,
           pts.count >= 2 {
            VStack(alignment: .leading, spacing: 8) {
                Text("VALUE BUILT")
                    .font(.system(.caption2, design: .monospaced)).foregroundStyle(.secondary)
                    .padding(.horizontal, 16)

                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(moneyK(t.total_with_undated ?? t.final_cumulative_dated ?? 0))
                        .font(.system(.title, design: .monospaced).weight(.semibold))
                    Text("invested").font(.caption2).foregroundStyle(.secondary)
                }
                .padding(.horizontal, 16)
                if let b = t.baseline?.delta {
                    Text("incl. \(money(b)) acquisition · the value you build, not wait to sell")
                        .font(.system(size: 10, design: .monospaced)).foregroundStyle(.tertiary)
                        .padding(.horizontal, 16)
                }

                Chart {
                    ForEach(pts) { p in
                        AreaMark(x: .value("Date", p.day!), y: .value("Invested", p.cumulative!))
                            .foregroundStyle(.linearGradient(colors: [Color.accentColor.opacity(0.28), Color.accentColor.opacity(0.02)],
                                                             startPoint: .top, endPoint: .bottom))
                        LineMark(x: .value("Date", p.day!), y: .value("Invested", p.cumulative!))
                            .foregroundStyle(Color.accentColor).interpolationMethod(.monotone)
                    }
                    if let first = pts.first, let d = first.day {
                        PointMark(x: .value("Date", d), y: .value("Invested", first.cumulative!))
                            .foregroundStyle(Color.accentColor).symbolSize(40)
                            .annotation(position: .topLeading) {
                                Text("bought").font(.system(size: 9, design: .monospaced)).foregroundStyle(.secondary)
                            }
                    }
                }
                .chartYScale(domain: 0...((pts.compactMap { $0.cumulative }.max() ?? 1) * 1.12))
                .chartYAxis {
                    AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { v in
                        AxisGridLine(); AxisValueLabel { if let d = v.as(Double.self) { Text(moneyK(d)) } }
                    }
                }
                .frame(height: 170).padding(.horizontal, 16)

                if let u = t.undated, let ut = u.total, ut > 0 {
                    Text("+ \(money(ut)) from \(u.n ?? 0) undated receipts — real spend, no date to place it on the curve")
                        .font(.system(size: 10, design: .monospaced)).foregroundStyle(.tertiary)
                        .padding(.horizontal, 16)
                }
            }
            .padding(.bottom, 16)
        }
        }
        .task(id: vehicleId) { await fetch() }
    }

    private func fetch() async {
        struct P: Encodable { let p_vehicle: String }
        t = try? await SupabaseService.client
            .rpc("get_vehicle_investment_timeline", params: P(p_vehicle: vehicleId))
            .execute().value
    }
}

// ─── Investment proof: proven vs projected — the asset-provenance file ───────
// Renders compute_vehicle_investment_proof as a traditional ledger: proven
// (receipts/payments/confirmed labor) above the line, projected below, every
// cell labeled with its source + confidence. The value an auditor can verify.

struct InvestmentProof: Decodable {
    struct Cell: Decodable {
        let value: Double?
        let count: Int?
        let source: String?
        let confidence: String?
    }
    struct Proven: Decodable {
        let parts: Cell
        let confirmed_labor: Cell
        let money_in: Cell
        let money_out: Cell
    }
    struct Projected: Decodable { let labor: Cell }
    /// The attributed / owner-stated rung: paid-by-other (no receipt) + gifted
    /// value. Above projected, below proven on the trust ladder.
    struct Attributed: Decodable { let cost: Cell; let income: Cell }
    struct Totals: Decodable {
        let invested_proven: Double?
        let invested_with_attributed: Double?
        let invested_with_projected: Double?
        let proven_income: Double?
        let net_proven: Double?
        let roi_proven_pct: Double?
    }
    /// One counterparty's net contribution to the asset — the per-party rung.
    /// Owner-only; empty when no recorded payments carry a counterparty.
    /// trust = "proven" (receipted/paid) or "attributed" (owner-stated).
    struct Party: Decodable, Identifiable {
        let party: String
        let direction: String?
        let count: Int?
        let total: Double?
        let trust: String?
        var id: String { party + (direction ?? "") + (trust ?? "") }
    }
    let is_owner_view: Bool
    let proven: Proven
    let attributed: Attributed?
    let projected: Projected
    let market: Cell
    let totals: Totals
    let by_party: [Party]?
    /// The drill behind each ledger cell — owner-only. The actual receipts,
    /// payments, and work_sessions the totals are summed from. This is the
    /// three-shelf law applied to the proudest number in the app: every figure
    /// opens to the rows that made it.
    let audit: Audit?

    struct Audit: Decodable {
        // Optional: for a non-owner viewer the proof returns audit = {} (empty
        // object). Non-optional arrays would throw keyNotFound on {} and null
        // the ENTIRE proof — hiding the whole INVESTMENT section for everyone
        // who isn't the owner. Optional → {} decodes to all-nil cleanly.
        let receipts: [Row]?
        let payments: [Row]?
        let work_sessions: [Row]?
        struct Row: Decodable, Identifiable {
            let id: UUID
            let source: String?
            // receipts
            let vendor: String?
            let amount: Double?
            let date: String?
            // payments
            let direction: String?
            let counterparty: String?
            let method: String?
            let confirmation: String?
            let description: String?
            // work_sessions
            let cost: Double?
            let confirmed: Bool?
        }
    }
}

/// A ledger cell tapped for its backing rows — the drill target.
struct LedgerDrill: Identifiable {
    enum Kind { case receipts, payments, labor }
    let title: String
    let kind: Kind
    let rows: [InvestmentProof.Audit.Row]
    var id: String { title }
}

struct InvestmentProofView: View {
    let vehicleId: String
    @State private var proof: InvestmentProof?
    @State private var loadFailed = false
    @State private var showAttest = false
    @State private var ledgerDrill: LedgerDrill?   // a cell tapped for its rows

    private func money(_ v: Double?) -> String {
        guard let v else { return "—" }
        return v.formatted(.currency(code: "USD").precision(.fractionLength(0)))
    }

    var body: some View {
        Group {
            if let p = proof {
                VStack(alignment: .leading, spacing: 0) {
                    // NEEDS YOU — the confirmable queue, made discoverable. Owner
                    // only. The owner's signature turns projected into proven, so
                    // surface it as the section's call-to-action instead of
                    // burying it in one dim ledger line. Tap → the confirm sheet.
                    if p.is_owner_view {
                        let unconfirmed = (p.audit?.work_sessions ?? []).filter { !($0.confirmed ?? false) }
                        if !unconfirmed.isEmpty {
                            Button {
                                ledgerDrill = LedgerDrill(title: "Labor", kind: .labor,
                                                          rows: p.audit?.work_sessions ?? [])
                            } label: {
                                HStack(spacing: 8) {
                                    Image(systemName: "checkmark.circle").foregroundStyle(.blue)
                                    Text("\(unconfirmed.count) work sessions need your confirmation")
                                        .foregroundStyle(.primary)
                                    Spacer(minLength: 8)
                                    Image(systemName: "chevron.right.circle")
                                        .font(.caption2).foregroundStyle(.blue)
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .padding(.vertical, 8)
                            Divider()
                        }
                    }

                    Text("INVESTMENT")
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(Color.secondary)
                        .padding(.top, 8).padding(.bottom, 4)

                    line("Parts", p.proven.parts.value, sub: "\(p.proven.parts.count ?? 0) receipts · proven",
                         onTap: drill("Parts", .receipts, p.audit?.receipts))
                    if (p.proven.confirmed_labor.value ?? 0) > 0 {
                        line("Labor (confirmed)", p.proven.confirmed_labor.value, sub: "proven",
                             onTap: drill("Labor", .labor, p.audit?.work_sessions))
                    }
                    if (p.proven.money_in.value ?? 0) > 0 {
                        line("Income", p.proven.money_in.value,
                             sub: "\(p.proven.money_in.count ?? 0) payments · proven", positive: true,
                             onTap: drill("Payments", .payments, p.audit?.payments))
                    }

                    // ATTRIBUTED — owner-stated (paid-by-other / gifted). A rung
                    // below proven, above projected: real value, owner's word.
                    if let attr = p.attributed,
                       (attr.cost.value ?? 0) > 0 || (attr.income.value ?? 0) > 0 {
                        Divider().overlay(Color.primary.opacity(0.3)).padding(.vertical, 4)
                        if (attr.cost.value ?? 0) > 0 {
                            line("Cost (owner-stated)", attr.cost.value,
                                 sub: "\(attr.cost.count ?? 0) attributed · paid by others")
                        }
                        if (attr.income.value ?? 0) > 0 {
                            line("Income (owner-stated)", attr.income.value,
                                 sub: "attributed", positive: true)
                        }
                    }

                    Divider().overlay(Color.primary.opacity(0.3)).padding(.vertical, 4)

                    line("Labor (projected)", p.projected.labor.value,
                         sub: "\(p.projected.labor.count ?? 0) sessions · tap to confirm", dim: true,
                         onTap: drill("Labor", .labor, p.audit?.work_sessions))
                    line("Market est.", p.market.value, sub: p.market.confidence ?? "", dim: true)

                    Divider().overlay(Color.primary.opacity(0.3)).padding(.vertical, 4)

                    line("Invested (proven)", p.totals.invested_proven,
                         sub: "+ projected: \(money(p.totals.invested_with_projected))", bold: true)
                    if let attr = p.attributed, (attr.cost.value ?? 0) > 0 {
                        line("Invested (+ owner-stated)", p.totals.invested_with_attributed,
                             sub: "proven + attributed", bold: true)
                    }
                    if let roi = p.totals.roi_proven_pct {
                        line("ROI (proven)", nil, sub: "on proven spend", bold: true, rawValue: "\(Int(roi))%")
                    }

                    // BY PARTY — who the money moved with. Each counterparty's
                    // net to the asset (owner-only; from payment_events).
                    if let parties = p.by_party, !parties.isEmpty {
                        Divider().overlay(Color.primary.opacity(0.3)).padding(.vertical, 4)
                        Text("BY PARTY")
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(Color.secondary)
                            .padding(.bottom, 2)
                        ForEach(parties) { party in
                            line(party.party, party.total,
                                 sub: "\(party.count ?? 0) \(party.direction == "in" ? "received" : "paid") · \(party.trust ?? "proven")",
                                 positive: party.direction == "in",
                                 dim: party.trust == "attributed")
                        }
                    }

                    // Owner attests a contribution → record_owner_contribution
                    // writes an owner-stated payment_event; the proof re-rolls.
                    if p.is_owner_view {
                        Divider().overlay(Color.primary.opacity(0.3)).padding(.vertical, 4)
                        Button { showAttest = true } label: {
                            Label("Add a contribution", systemImage: "plus.circle")
                                .font(.system(.footnote, design: .monospaced))
                                .foregroundStyle(.blue)
                        }
                        .buttonStyle(.plain)
                        .padding(.vertical, 2)
                    }
                }
                .font(.system(.footnote, design: .monospaced))
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
                // Ledger drill sheet — attached to the VStack (a DIFFERENT view
                // than the showAttest sheet below) so both present reliably;
                // two .sheet modifiers on one view suppress the second.
                .sheet(item: $ledgerDrill) { drill in
                    LedgerEvidenceSheet(drill: drill) { Task { await load() } }
                }
            } else if loadFailed {
                // Don't vanish silently after the retries failed — say so + offer retry.
                HStack(spacing: 8) {
                    Text("INVESTMENT")
                        .font(.system(.caption2, design: .monospaced)).foregroundStyle(.secondary)
                    Spacer()
                    Button("Retry") { Task { await load() } }.font(.caption)
                }
                .padding(.horizontal, 16).padding(.vertical, 10)
            }
        }
        .task(id: vehicleId) { await load() }
        .sheet(isPresented: $showAttest) {
            AttestContributionView(vehicleId: vehicleId) { Task { await load() } }
        }
    }

    @ViewBuilder private func line(_ label: String, _ value: Double?, sub: String,
                                   positive: Bool = false, dim: Bool = false,
                                   bold: Bool = false, rawValue: String? = nil,
                                   onTap: (() -> Void)? = nil) -> some View {
        let row = HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 1) {
                Text(label).foregroundStyle(dim ? Color.secondary : Color.primary)
                if !sub.isEmpty {
                    Text(sub).font(.system(.caption2, design: .monospaced)).foregroundStyle(Color.secondary)
                }
            }
            Spacer(minLength: 8)
            Text(rawValue ?? money(value))
                .fontWeight(bold ? .semibold : .regular)
                .foregroundStyle(positive ? Color.green : (dim ? Color.secondary : Color.primary))
            if onTap != nil {
                Image(systemName: "chevron.right.circle").font(.caption2).foregroundStyle(.blue)
            }
        }
        .padding(.vertical, 3)
        .contentShape(Rectangle())

        if let onTap {
            Button(action: onTap) { row }.buttonStyle(.plain)
        } else {
            row
        }
    }

    /// Build a drill for a ledger cell IFF the owner audit carries its rows.
    private func drill(_ title: String, _ kind: LedgerDrill.Kind, _ rows: [InvestmentProof.Audit.Row]?) -> (() -> Void)? {
        guard let rows, !rows.isEmpty else { return nil }
        return { ledgerDrill = LedgerDrill(title: title, kind: kind, rows: rows) }
    }

    private func load() async {
        // Retry: a cold app/network start can stall or cancel the first request
        // (-999 / data_stall), which would silently leave the whole INVESTMENT
        // section absent. A couple of spaced retries make it reliable on first
        // launch (device cold-start as well as the sim).
        for attempt in 0..<3 {
            do {
                proof = try await SupabaseService.client
                    .rpc("compute_vehicle_investment_proof", params: ["p_vehicle_id": vehicleId])
                    .execute()
                    .value
                loadFailed = false
                break
            } catch {
                NSLog("NukeCapture investment proof attempt %d failed: %@", attempt, String(describing: error))
                loadFailed = (proof == nil)   // surface only if we still have nothing
                try? await Task.sleep(nanoseconds: 800_000_000)
            }
        }
        #if DEBUG
        // Screenshot loop: auto-open a ledger drill (NUKE_DEBUG_LEDGER=labor).
        if ledgerDrill == nil,
           let kind = ProcessInfo.processInfo.environment["NUKE_DEBUG_LEDGER"],
           kind == "labor", let rows = proof?.audit?.work_sessions, !rows.isEmpty {
            ledgerDrill = LedgerDrill(title: "Labor", kind: .labor, rows: rows)
        }
        #endif
    }
}

// ─── Attest a contribution: the owner-stated rung's write surface ────────────
// The owner records a party's contribution (dad bought the tires; seats
// reupholstered, no payment). Lands as an owner-stated payment_event via
// record_owner_contribution; the proof re-rolls with a new attributed rung.
// The owner's attestation IS the value-confirmation signal (the $410 guard).

private struct AttestContributionView: View {
    let vehicleId: String
    var onSaved: () -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var party = ""
    @State private var amount = ""
    @State private var direction = "out"
    @State private var basis = ""
    @State private var saving = false
    @State private var error: String?

    /// Mixed-type RPC params need an Encodable struct (not a [String:String] dict).
    private struct Params: Encodable {
        let p_vehicle_id: String
        let p_party: String
        let p_amount: Double
        let p_direction: String
        let p_basis: String
    }

    private var amountValue: Double? {
        Double(amount.trimmingCharacters(in: .whitespaces))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Who contributed") {
                    TextField("Party — e.g. Dad", text: $party)
                        .textInputAutocapitalization(.words)
                }
                Section("What") {
                    TextField("Amount (USD)", text: $amount)
                        .keyboardType(.decimalPad)
                    Picker("Type", selection: $direction) {
                        Text("Cost — paid for it").tag("out")
                        Text("Income — paid in").tag("in")
                    }
                    TextField("Basis — e.g. bought tires, no receipt",
                              text: $basis, axis: .vertical)
                }
                if let error {
                    Section { Text(error).font(.footnote).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Owner-stated")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Save") { Task { await save() } }
                        .disabled(saving || (amountValue ?? 0) <= 0)
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func save() async {
        guard let amt = amountValue, amt > 0 else { return }
        saving = true; error = nil
        defer { saving = false }
        do {
            _ = try await SupabaseService.client
                .rpc("record_owner_contribution", params: Params(
                    p_vehicle_id: vehicleId,
                    p_party: party.trimmingCharacters(in: .whitespaces),
                    p_amount: amt,
                    p_direction: direction,
                    p_basis: basis.trimmingCharacters(in: .whitespaces)
                ))
                .execute()
            onSaved()
            dismiss()
        } catch {
            self.error = "Couldn't save — \(error.localizedDescription)"
            NSLog("NukeCapture record_owner_contribution failed: %@", String(describing: error))
        }
    }
}

// ─── Spec drill-to-source: the value, then the table behind it ───────────────
// A spec row descriptor + the tapped-field token + the provenance sheet. This is
// the three-shelf law applied to the spec table: a value that has a recorded
// source opens to that source — the inline source string, how sure, the SOURCE
// PHOTO (e.g. the door-jamb VIN plate), and the observations that recorded it.
// Nothing renders here that the data didn't call into existence.

/// A tapped spec value awaiting its provenance sheet.
struct SpecDrill: Identifiable {
    let label: String
    let value: String
    let field: String
    var id: String { field + value }
}

/// One row from get_vehicle_specs — a spec value tagged FACT vs FACADE.
/// `rooted` = a real atom (source photo / field-keyed observation / extraction
/// evidence) backs it; a bare {field}_source label is NOT a root.
struct VehicleSpec: Decodable, Identifiable {
    let field: String
    let label: String
    let value: String?
    let rooted: Bool
    let inline_source: String?
    let evidence_count: Int?
    var id: String { field }
}

/// get_vehicle_valuation — the comp-based market estimate + the basis it leaned on.
// ─── The comment thread — a summoned bottom sheet (the universal social pattern),
// never spliced into the page spine. Thread scrolls; the composer is pinned to the
// bottom above the keyboard. Reuses the page's record_interaction/get_vehicle_engagement
// grammar verbatim — this is placement, not new data.
private struct CommentsSheet: View {
    let engagement: VehicleEngagement?
    @Binding var commentDraft: String
    @Binding var posting: Bool
    let onPost: () async -> Void
    @Environment(\.dismiss) private var dismiss

    private var count: Int { engagement?.comment_count ?? 0 }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    if let e = engagement, !e.recent_comments.isEmpty {
                        ForEach(e.recent_comments) { c in row(c) }
                    } else {
                        Text("Be the first to weigh in.")
                            .font(.callout).foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity).padding(.top, 48)
                    }
                }
                .padding(16)
            }
            .navigationTitle(count > 0 ? "\(count) Comment\(count == 1 ? "" : "s")" : "Comments")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
            .safeAreaInset(edge: .bottom) { composer }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    @ViewBuilder private func row(_ c: VehicleEngagement.Comment) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(c.text ?? "")
                .font(.footnote).foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
            Text("\(c.is_me == true ? "you" : (c.author ?? "someone"))\(c.at.map { " · " + String($0.prefix(10)) } ?? "")")
                .font(.caption2).monospacedDigit().foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
    }

    @ViewBuilder private var composer: some View {
        if SupabaseService.currentUserId != nil {
            HStack(spacing: 8) {
                TextField("Add a comment…", text: $commentDraft, axis: .vertical)
                    .textFieldStyle(.plain).lineLimit(1...4).submitLabel(.send)
                Button { Task { await onPost() } } label: {
                    if posting { ProgressView().scaleEffect(0.7) }
                    else { Image(systemName: "arrow.up.circle.fill").font(.title2) }
                }
                .disabled(posting || commentDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding(12)
            .background(.bar)
        } else {
            Text("Sign in to weigh in.")
                .font(.caption).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity).padding(12).background(.bar)
        }
    }
}

/// A horizontal strip of tappable "+ field" chips — the record's gaps as one-tap
/// contribution prompts.
private struct FlowChips: View {
    let items: [String]
    let onTap: (Int) -> Void
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Array(items.enumerated()), id: \.offset) { idx, label in
                    Button { onTap(idx) } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "plus").font(.system(size: 9, weight: .bold))
                            Text(label).font(.caption2.weight(.medium))
                        }
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .foregroundStyle(.primary)
                        .overlay { Capsule().stroke(.secondary.opacity(0.4), lineWidth: 1) }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

struct VehicleValuation: Decodable {
    let value: Double?
    let value_low: Double?
    let value_high: Double?
    let confidence: Int?
    let comp_count: Int?
    let is_stale: Bool?
    let calculated_at: String?
    let price_tier: String?
    let model_version: String?
    // The power under the hood — the model's real backing, so the surface can be
    // honest about how thin (or rich) the estimate actually is.
    let input_count: Int?
    let confidence_interval_pct: Double?
    let is_circular: Bool?
    let comp_method: String?
    let deal_score: Double?
    let deal_score_label: String?
    let heat_score: Double?
    let heat_score_label: String?
    let signals: [Signal]?

    struct Signal: Decodable, Identifiable {
        let name: String
        let weight: Double?
        let source_count: Int?
        let fired: Bool?
        var id: String { name }
    }

    /// How many of the model's signals actually had data behind them.
    var signalsFired: Int { (signals ?? []).filter { $0.fired == true }.count }
    var signalsTotal: Int { (signals ?? []).count }
    /// NOT defensible — block the price — until the comps are build-class-stratified.
    /// A resto-mod priced on stock-truck comps is wrong even with many signals firing
    /// (condition/originality fire now, but the comp ANCHOR is still class-blind), so
    /// the estimate stays "Not priced yet" until comp_method proves the comps match
    /// this vehicle's build class. Then the ≤1-signal / ≤1-input floor still applies.
    var isThin: Bool {
        guard comp_method == "class_stratified" else { return signalsTotal > 0 }
        return signalsFired <= 1 || (input_count ?? 0) <= 1
    }
}

/// get_vehicle_engagement(vehicle) → one jsonb object: the engagement ladder's
/// surface (signal counts + recent testimony). Bare object, decode directly.
struct VehicleEngagement: Decodable {
    let following_count: Int
    let is_following: Bool
    let comment_count: Int
    let contribution_count: Int
    let recent_comments: [Comment]

    struct Comment: Decodable, Identifiable {
        let id: UUID
        let text: String?
        let at: String?
        let author: String?
        let is_me: Bool?
    }
}

/// get_field_provenance(vehicle, field) → one jsonb object. Every piece optional
/// so a sparse field still decodes; the sheet renders only what exists.
struct FieldProvenance: Decodable {
    let field: String?
    let value: String?
    let inline_source: String?
    let inline_confidence: String?     // to_jsonb text ("1","0.95")
    let source_image_url: String?
    let evidence: [Evidence]
    let observations: [Observation]

    struct Evidence: Decodable, Identifiable {
        let source: String?
        let value: String?
        let source_type: String?
        let confidence: Double?
        let verified: Bool?
        let reasoning: String?
        let image_id: String?
        let at: String?
        var id: String { (source_type ?? "") + (at ?? "") + (value ?? "") }
    }
    struct Observation: Decodable, Identifiable {
        let id: UUID
        let content: String?
        let value: String?
        let confidence: Double?
        let observed_at: String?
        let kind: String?
        let source_slug: String?
        let trust: Double?
        let source_url: String?
    }
}

struct FieldProvenanceSheet: View {
    let vehicleId: String
    let drill: SpecDrill
    @Environment(\.dismiss) private var dismiss

    @State private var prov: FieldProvenance?
    @State private var loaded = false
    @State private var loadFailed = false   // a failed trace ≠ "no source exists"
    @State private var zoomURL: String?
    @State private var zoomOpen = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    valueHeader
                    Divider()
                    if let p = prov {
                        sourceLine(p)
                        if let img = p.source_image_url, !img.isEmpty { sourceImage(img) }
                        if !p.observations.isEmpty { observationsSection(p.observations) }
                        if !p.evidence.isEmpty { evidenceSection(p.evidence) }
                        if hasNothing(p) { emptyState }
                    } else if loadFailed {
                        // The trace failed — don't claim "no source exists yet".
                        VStack(alignment: .leading, spacing: 10) {
                            Label("Couldn't trace the source", systemImage: "wifi.exclamationmark")
                                .font(.footnote).foregroundStyle(.secondary)
                            Button("Retry") { Task { await load() } }
                                .font(.footnote)
                        }.padding(16)
                    } else if loaded {
                        emptyState
                    } else {
                        HStack(spacing: 8) {
                            ProgressView()
                            Text("Tracing source…").font(.footnote).foregroundStyle(.secondary)
                        }.padding(16)
                    }
                }
            }
            .navigationTitle(drill.label)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
        .task { await load() }
        .fullScreenCover(isPresented: $zoomOpen) {
            FullScreenGalleryView(images: zoomURL.map { [$0] } ?? [])
        }
    }

    // ─── Value header — the figure, its confidence, copy ─────────────────────
    private var valueHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(drill.value)
                .font(.system(.title3, design: .monospaced).weight(.semibold))
                .foregroundStyle(.primary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 14) {
                if let c = confidenceText {
                    Label(c, systemImage: "gauge.with.dots.needle.50percent")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Button { UIPasteboard.general.string = drill.value } label: {
                    Label("Copy", systemImage: "doc.on.doc").font(.caption)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
    }

    @ViewBuilder private func sourceLine(_ p: FieldProvenance) -> some View {
        if let src = p.inline_source, !src.isEmpty {
            VStack(alignment: .leading, spacing: 3) {
                Text("RECORDED SOURCE")
                    .font(.system(.caption2, design: .monospaced)).foregroundStyle(.secondary)
                Text(src).font(.footnote).foregroundStyle(.primary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16).padding(.vertical, 12)
            Divider()
        }
    }

    @ViewBuilder private func sourceImage(_ url: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("SOURCE PHOTO")
                .font(.system(.caption2, design: .monospaced)).foregroundStyle(.secondary)
            Button { zoomURL = url; zoomOpen = true } label: {
                CachedAsyncImage(url: NukeImage.thumb(url, width: 1000)) { i in
                    i.resizable().scaledToFit()
                } placeholder: {
                    Color(.secondarySystemFill).frame(height: 200).overlay { ProgressView() }
                }
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(.plain)
            Text("The on-vehicle evidence this value was read from. Tap to enlarge.")
                .font(.caption2).foregroundStyle(.tertiary)
        }
        .padding(16)
        Divider()
    }

    @ViewBuilder private func observationsSection(_ obs: [FieldProvenance.Observation]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("OBSERVED")
                .font(.system(.caption2, design: .monospaced)).foregroundStyle(.secondary)
            ForEach(obs) { o in
                VStack(alignment: .leading, spacing: 5) {
                    if let c = o.content, !c.isEmpty {
                        Text(c).font(.footnote).foregroundStyle(.primary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    HStack(spacing: 6) {
                        ForEach(observationFacets(o), id: \.self) { facet in
                            Text(facet).font(.system(.caption2, design: .monospaced))
                                .foregroundStyle(.secondary)
                        }
                    }
                    if let u = o.source_url, let link = URL(string: u) {
                        Link("View source ↗", destination: link).font(.caption2)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
            }
        }
        .padding(16)
    }

    @ViewBuilder private func evidenceSection(_ ev: [FieldProvenance.Evidence]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("EXTRACTION EVIDENCE")
                .font(.system(.caption2, design: .monospaced)).foregroundStyle(.secondary)
            ForEach(ev) { e in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(e.source_type ?? "source").font(.footnote.weight(.medium))
                        Spacer()
                        if let c = pct(e.confidence) {
                            Text(c).font(.system(.caption2, design: .monospaced)).foregroundStyle(.secondary)
                        }
                        if e.verified == true {
                            Image(systemName: "checkmark.seal.fill").font(.caption2).foregroundStyle(.green)
                        }
                    }
                    if let r = e.reasoning, !r.isEmpty {
                        Text(r).font(.caption2).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
            }
        }
        .padding(16)
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("This value is on the vehicle record but isn't yet traced to an observation.")
                .font(.footnote).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
    }

    // ─── helpers ─────────────────────────────────────────────────────────────
    private func hasNothing(_ p: FieldProvenance) -> Bool {
        (p.inline_source?.isEmpty != false) && p.source_image_url == nil
            && p.observations.isEmpty && p.evidence.isEmpty
    }

    private func observationFacets(_ o: FieldProvenance.Observation) -> [String] {
        var f: [String] = []
        if let s = o.source_slug, !s.isEmpty { f.append(s) }
        if let t = pct(o.trust) { f.append("trust \(t)") }
        if let c = pct(o.confidence) { f.append(c) }
        if let at = o.observed_at { f.append(String(at.prefix(10))) }
        return f
    }

    private var confidenceText: String? {
        guard let raw = prov?.inline_confidence, let v = Double(raw) else { return nil }
        return pct(v).map { "Confidence \($0)" }
    }

    /// 0–1 fractions scale ×100; values already >1 are treated as whole percent.
    private func pct(_ v: Double?) -> String? {
        guard let v else { return nil }
        let p = v <= 1.0 ? v * 100 : v
        return "\(Int(p.rounded()))%"
    }

    private func load() async {
        loadFailed = false
        do {
            prov = try await SupabaseService.client
                .rpc("get_field_provenance",
                     params: ["p_vehicle_id": vehicleId, "p_field": drill.field])
                .execute()
                .value
        } catch {
            loadFailed = true
            NSLog("NukeCapture field provenance failed: %@", String(describing: error))
        }
        loaded = true
    }
}

// ─── Ledger evidence + the CONFIRM verb ──────────────────────────────────────
// The rows behind a ledger cell — receipts / payments / work sessions, the same
// audit the proof already returns (owner-only). For the labor bucket each
// unconfirmed session carries CONFIRM: tapping it promotes that session from
// projected → proven (confirm_work_session), the parent proof re-rolls, and the
// owner watches "Invested (proven)" climb in the same turn. The app finally lets
// you CLIMB the trust ladder it draws — the owner's signature is the product.

private struct LedgerEvidenceSheet: View {
    typealias Row = InvestmentProof.Audit.Row
    let drill: LedgerDrill
    var onChanged: () -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var confirmed: Set<UUID> = []   // promoted (post-success)
    @State private var working: UUID?
    @State private var failed: Set<UUID> = []      // RPC failed — surface, don't swallow

    private func money(_ v: Double?) -> String {
        guard let v else { return "—" }
        return v.formatted(.currency(code: "USD").precision(.fractionLength(0)))
    }

    private var unconfirmedCount: Int {
        drill.rows.filter { !($0.confirmed ?? false) && !confirmed.contains($0.id) }.count
    }

    var body: some View {
        NavigationStack {
            List {
                if drill.kind == .labor, unconfirmedCount > 0 {
                    Section {
                        Text("\(unconfirmedCount) session\(unconfirmedCount == 1 ? "" : "s") awaiting your confirmation. Confirming promotes labor from projected to proven.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                ForEach(drill.rows) { row in
                    switch drill.kind {
                    case .receipts: receiptRow(row)
                    case .payments: paymentRow(row)
                    case .labor:    laborRow(row)
                    }
                }
            }
            .listStyle(.plain)
            .navigationTitle(drill.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder private func receiptRow(_ r: Row) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(r.vendor ?? "Receipt").font(.footnote)
                if let d = r.date { Text(String(d.prefix(10))).font(.caption2).foregroundStyle(.secondary) }
            }
            Spacer()
            Text(money(r.amount)).font(.system(.footnote, design: .monospaced))
        }
    }

    @ViewBuilder private func paymentRow(_ r: Row) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(r.counterparty ?? r.description ?? "Payment").font(.footnote)
                if let m = r.method { Text(m).font(.caption2).foregroundStyle(.secondary) }
            }
            Spacer()
            Text((r.direction == "in" ? "+" : "") + money(r.amount))
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(r.direction == "in" ? .green : .primary)
        }
    }

    @ViewBuilder private func laborRow(_ r: Row) -> some View {
        let isConfirmed = (r.confirmed ?? false) || confirmed.contains(r.id)
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(r.date.map { String($0.prefix(10)) } ?? "Work session").font(.footnote)
                Text(money(r.cost)).font(.system(.caption2, design: .monospaced)).foregroundStyle(.secondary)
            }
            Spacer()
            if isConfirmed {
                Label("Proven", systemImage: "checkmark.seal.fill")
                    .labelStyle(.titleAndIcon).font(.caption2).foregroundStyle(.green)
            } else if working == r.id {
                ProgressView()
            } else if failed.contains(r.id) {
                // The RPC failed — say so and let them retry, never silently nothing.
                Button { Task { await confirm(r.id) } } label: {
                    Label("Retry", systemImage: "exclamationmark.arrow.circlepath")
                        .font(.caption2)
                }
                .buttonStyle(.bordered).controlSize(.small).tint(.red)
            } else {
                Button("Confirm") { Task { await confirm(r.id) } }
                    .buttonStyle(.borderedProminent).controlSize(.small)
            }
        }
    }

    private func confirm(_ id: UUID) async {
        working = id
        defer { working = nil }
        struct P: Encodable { let p_session_id: String; let p_confirm: Bool }
        do {
            _ = try await SupabaseService.client
                .rpc("confirm_work_session", params: P(p_session_id: id.uuidString, p_confirm: true))
                .execute()
            failed.remove(id)
            confirmed.insert(id)   // promote only after the server accepted it
            onChanged()            // parent re-rolls the proof
        } catch {
            failed.insert(id)      // surface it — the row shows Retry, not silence
            NSLog("NukeCapture confirm_work_session failed: %@", String(describing: error))
        }
    }
}
