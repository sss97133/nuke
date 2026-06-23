// TodayView.swift — live capture telemetry, the owner's main watch.
//
// What makes this screen the native value layer:
//   • big moving numbers pulled from on-device SyncEngine state
//   • local PHAsset thumbnails — nothing a web page can do
//   • queue-drain progress live as backfill empties
//
// Design: tight metrics strip + thumbnail strip, no section noise.
// Privacy caption replaces the old paragraph — one honest line.

import SwiftUI
import Photos

struct TodayView: View {
    @ObservedObject private var engine = SyncEngine.shared
    @ObservedObject private var attribution = AttributionEngine.shared
    @State private var showAccount = false

    var body: some View {
        NavigationStack {
            List {
                // ── Errors / permission banner ──
                // Only the ACTIONABLE permission state earns a banner. The old
                // engine.lastError banner (a stale per-upload error) was noise the
                // owner can't act on — dropped; failures live in the logs.
                if engine.authorizationDenied {
                    Section {
                        Label(
                            "Photos access is off. Enable it in Settings → Privacy & Security → Photos → Nuke.",
                            systemImage: "exclamationmark.triangle"
                        )
                        .font(.footnote)
                        .foregroundStyle(.orange)
                    }
                }

                // ── Live metrics strip ──
                Section {
                    LiveMetricsStrip(engine: engine)
                        .listRowInsets(EdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16))
                        .listRowBackground(Color.clear)
                }

                // ── Live analysis · the pipeline on the wire ──
                // The ENGINE worklight: each frame's DEEP verdict landing in
                // realtime (get_analysis_stream), newest first — the data itself
                // streaming, not a progress bar. Tap a frame → its evidence (the
                // same rail the ANALYZED grid drills to). Self-loading.
                if let uid = SupabaseService.currentUserId {
                    LiveAnalysisStream(userId: uid)
                }

                // ── Your garage ── Today opens onto the owner's actual record,
                // not just relay counters. Self-loading; renders nothing if empty.
                if let uid = SupabaseService.currentUserId {
                    GarageStrip(userId: uid)
                }

                // ── Just read · on-device (T0) ──
                // The live capture demo: a frame shot at the site is read on-device
                // (Apple Vision) the instant it uploads — the detection lands here
                // in seconds, no network. A DETECTION (a label), not confirmed work.
                if !engine.liveT0Atoms.isEmpty {
                    Section {
                        LiveT0Strip(atoms: engine.liveT0Atoms)
                            .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                    } header: {
                        Label("Just read · on-device", systemImage: "wand.and.stars")
                    } footer: {
                        Text("Read on this phone in milliseconds — a detection, not confirmed work.")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }

                // ── Understanding: the record assembling itself (BUILD_2 §G14) ──
                // The mesh growing — days/frames becoming understood tick up live
                // as the analysis engine lands them; the latest understood days
                // stream in. Distinct from the capture-relay counters above.
                if let uid = SupabaseService.currentUserId {
                    UnderstandingPanel(userId: uid)
                }

                // ── Recent uploads (local thumbnails) ──
                if !engine.recentUploadIDs.isEmpty {
                    Section("Recent uploads") {
                        RecentUploadsStrip(assetIdentifiers: engine.recentUploadIDs)
                            .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                    }
                }

                // ── Actions + pause toggle ──
                Section {
                    Button {
                        Task { await engine.sync() }
                    } label: {
                        Label("Sync Now", systemImage: "arrow.triangle.2.circlepath")
                    }
                    .disabled(engine.isSyncing)

                    // Analyze Today — user-triggered on-device attribution run
                    // (the tuning surface: the owner decides when to route the
                    // day's photos home). On-device, free, no Mac, no GPU.
                    Button {
                        Task { await attribution.run() }
                    } label: {
                        if attribution.isRunning, attribution.progress.total > 0 {
                            Label("Analyzing \(attribution.progress.done)/\(attribution.progress.total)…",
                                  systemImage: "wand.and.stars")
                        } else {
                            Label("Analyze Today", systemImage: "wand.and.stars")
                        }
                    }
                    .disabled(attribution.isRunning)

                    // Confirm sessions — the backlog sweep: one tap routes a day's
                    // photos to a vehicle (handles VIN-less + new-vehicle cases).
                    NavigationLink {
                        SessionConfirmView()
                    } label: {
                        Label("Confirm sessions", systemImage: "checklist")
                    }

                    // Tier 3 → 4: the day-journal sign surface, promoted to a
                    // direct entry (it was buried a level under Confirm sessions).
                    NavigationLink {
                        WorkDaySignView()
                    } label: {
                        Label("Confirm your days", systemImage: "checkmark.seal")
                    }

                    // Pause toggle — secondary; the big numbers are the hero
                    Toggle("Uploads", isOn: Binding(
                        get: { !engine.isPaused },
                        set: { engine.setPaused(!$0) }
                    ))
                } footer: {
                    VStack(alignment: .leading, spacing: 4) {
                        // Privacy story: one line instead of a paragraph
                        Text("On-site photos only · \(engine.totalSkippedOffShop) held back")
                        if let s = attribution.lastSummary {
                            Text(s)   // what the last Analyze Today run routed
                        }
                    }
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Today")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showAccount = true
                    } label: {
                        Image(systemName: "person.circle")
                    }
                    .accessibilityLabel("Account")
                }
            }
            .sheet(isPresented: $showAccount) {
                AccountView()
            }
            .refreshable {
                await engine.sync()
            }
        }
    }
}

// ─── Understanding: the mesh growing (BUILD_2 §G14) ─────────────────────────────
//
// The owner's whole record being understood — fed by get_user_understanding over
// work_sessions (the day rollup is the analysis unit; sum(image_count) is the fast
// frames proxy). Two counters tick up via .numericText as the engine lands days,
// and the latest understood days stream in, each drilling to its day receipt. A
// 30s poll loop makes the accretion visible while the screen is open.

/// get_user_understanding(p_user_id) → jsonb (scalar) → PostgREST array-wraps it,
/// so decode [UserUnderstanding] and take .first (same pattern as the day receipt).
struct UserUnderstanding: Decodable {
    let is_owner_view: Bool?
    let days_understood: Int
    let frames_understood: Int
    let days_today: Int
    let latest: [Day]

    struct Day: Decodable, Identifiable {
        let date: String          // "yyyy-MM-dd" — drills to DayReceiptView
        let vehicle_id: UUID?
        let make: String?
        let model: String?
        let frames: Int?
        let title: String?        // the day's classification (work_type)
        let story: String?        // work_description — the detective's day narrative
        let minutes: Int?

        var id: String { date + (vehicle_id?.uuidString ?? "") }
        var vehicleTitle: String {
            let parts = [make, model].compactMap { $0 }.filter { !$0.isEmpty }
            return parts.isEmpty ? "VEHICLE" : parts.joined(separator: " ").uppercased()
        }
    }
}

private struct UnderstandingPanel: View {
    let userId: String
    @State private var u: UserUnderstanding?
    @State private var loadError = false   // a failed fetch ≠ "still reading the record"

    var body: some View {
        Group {
            Section {
                if let u {
                    HStack(spacing: 0) {
                        MetricCell(
                            label: "DAYS UNDERSTOOD",
                            value: "\(u.days_understood)",
                            caption: u.days_today > 0 ? "+\(u.days_today) today" : nil
                        )
                        Divider().frame(height: 44)
                        MetricCell(label: "FRAMES", value: "\(u.frames_understood)")
                    }
                    .listRowInsets(EdgeInsets(top: 12, leading: 16, bottom: 8, trailing: 16))
                    .listRowBackground(Color.clear)
                } else if loadError {
                    // The fetch failed — don't sit on "Reading the record…" forever.
                    HStack(spacing: 8) {
                        Label("Couldn't load", systemImage: "wifi.exclamationmark")
                            .font(.caption2).foregroundStyle(.secondary)
                        Spacer()
                        Button("Retry") { Task { await fetch() } }
                            .font(.caption2)
                    }
                    .listRowBackground(Color.clear)
                } else {
                    HStack(spacing: 8) {
                        ProgressView().scaleEffect(0.7)
                        Text("Reading the record…")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                    .listRowBackground(Color.clear)
                }
            } header: {
                Text("Understanding")
            } footer: {
                Text("Your record assembling itself — frames becoming understood.")
                    .font(.caption2).foregroundStyle(.secondary)
            }

            if let u, !u.latest.isEmpty {
                Section("Latest understood") {
                    ForEach(u.latest) { day in
                        NavigationLink {
                            DayReceiptView(userId: userId, date: day.date)
                        } label: {
                            row(day)
                        }
                    }
                }
            }
        }
        .task(id: userId) { await poll() }
    }

    @ViewBuilder private func row(_ d: UserUnderstanding.Day) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            // The story leads — the detective's read of the day. A day not yet
            // narrated falls back to its vehicle + classification.
            if let story = d.story, !story.isEmpty {
                Text(story)
                    .font(.footnote)
                    .foregroundStyle(Color.primary)
                    .lineLimit(3)
            } else {
                Text(d.vehicleTitle)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Color.primary)
                    .lineLimit(1)
                if let title = d.title, !title.isEmpty {
                    Text(title)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            // Structured footer: vehicle · N frames · date.
            HStack(spacing: 6) {
                Text(d.vehicleTitle).lineLimit(1)
                Text("·")
                Text("\(d.frames ?? 0) frames")
                Text("·")
                Text(d.date)
                Spacer(minLength: 0)
            }
            .font(.caption2).monospacedDigit()
            .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 3)
    }

    /// Poll every 30s while the screen is open — the burn-all lands ~5 frames/min,
    /// so the counters climb and new rows appear in front of the owner.
    private func poll() async {
        while !Task.isCancelled {
            await fetch()
            try? await Task.sleep(for: .seconds(30))
        }
    }

    private func fetch() async {
        loadError = false
        do {
            // get_user_understanding RETURNS jsonb (scalar) — PostgREST returns a
            // bare OBJECT body ({"latest":[...]}), NOT an array. Decoding
            // [UserUnderstanding] (the old code) silently failed every time, so the
            // panel was stuck on "Reading the record…" forever. Decode the object.
            let row: UserUnderstanding = try await SupabaseService.client
                .rpc("get_user_understanding", params: ["p_user_id": userId])
                .execute()
                .value
            withAnimation(.easeInOut(duration: 0.4)) { u = row }
        } catch {
            // Only surface the failure when we have nothing yet — a failed REFRESH
            // mustn't wipe metrics already on screen (the if-let-u branch wins).
            if u == nil { loadError = true }
            NSLog("NukeCapture understanding fetch failed: %@", String(describing: error))
        }
    }
}

// ─── Live metrics strip ───────────────────────────────────────────────────────

/// Four big monospaced counters. QUEUED — the live backfill drain — is the
/// hero: it counts DOWN as the background BGProcessingTask empties the queue
/// with the screen off (the pour is the show, BUILD_2 G9). ANALYZED drills
/// into the photos + atoms behind the count. All capture-scoped and fast
/// (local counters + get_user_analyzed_count), never the all-sources aggregate
/// that times out on heavy libraries — and the ANALYZED count here is the same
/// predicate the drill shows, so the number and the photos always agree.
private struct LiveMetricsStrip: View {
    @ObservedObject var engine: SyncEngine

    /// Honest ETA — only a measured rate produces a time; otherwise "estimating…"
    /// rather than an invented number (C4: every number real).
    static func etaLine(remaining: Int, perMinute: Double) -> String {
        guard perMinute > 0 else {
            return "Uploading \(remaining) from this device… (estimating…)"
        }
        let mins = Double(remaining) / perMinute
        let eta: String
        if mins < 1 {
            eta = "<1 min left"
        } else if mins < 60 {
            eta = "~\(Int(mins.rounded())) min left"
        } else {
            let h = Int(mins / 60)
            let m = Int(mins.truncatingRemainder(dividingBy: 60).rounded())
            eta = "~\(h)h \(m)m left"
        }
        return "Uploading \(remaining) from this device… \(eta)"
    }

    /// A server metric, or "…" until the first stats load lands (never a fake 0).
    private func stat(_ v: Int) -> String { engine.statsLoaded ? "\(v)" : "…" }

    var body: some View {
        VStack(spacing: 14) {
            // THE FUNNEL — the owner's own library, organized (C2). LIBRARY is
            // the whole on-device count from the ignition scan (e.g. 76K);
            // RELEVANT is the confirmed at-site set. Shown once ignition has
            // measured them. RUNS ON: IgnitionEngine.scan.
            if engine.libraryTotal > 0 {
                HStack(spacing: 0) {
                    MetricCell(label: "LIBRARY", value: "\(engine.libraryTotal)")
                    Divider().frame(height: 44)
                    MetricCell(label: "RELEVANT", value: "\(engine.relevantTotal)")
                }
            }

            // THE REAL RECORD — server truth (get_user_capture_stats). Until the
            // first load lands (the RPC can be ~9s cold) the cells read "…", never
            // a fake "0" — a 0 here reads as a dead, empty record (it isn't). And a
            // FAILED first load shows a retry, never a "…" that never resolves.
            if engine.statsError && !engine.statsLoaded {
                HStack {
                    Label("Couldn't load your record", systemImage: "wifi.exclamationmark")
                        .font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Retry") { Task { await engine.refreshAnalyzedCount() } }
                        .font(.caption)
                }
            } else {
                HStack(spacing: 0) {
                    MetricCell(label: "UPLOADED", value: stat(engine.serverStats.total_images))
                    Divider().frame(height: 44)
                    // ANALYZED = the REAL vision-analyzed count (engine.analyzedCount,
                    // get_user_analyzed_count) — the SAME population the drill resolves
                    // to. NEVER serverStats.analyzed (the 12k work_sessions rollup).
                    if engine.analyzedCount > 0 {
                        NavigationLink {
                            AnalyzedPhotosView(userId: SupabaseService.currentUserId ?? "")
                        } label: {
                            MetricCell(label: "ANALYZED",
                                       value: "\(engine.analyzedCount)",
                                       caption: "tap to view")
                        }
                        .buttonStyle(.plain)
                    } else {
                        MetricCell(
                            label: "ANALYZED",
                            value: stat(engine.analyzedCount),
                            caption: (engine.statsLoaded && engine.serverStats.total_images > 0) ? "analyzing…" : nil
                        )
                    }
                }

                HStack(spacing: 0) {
                    MetricCell(label: "DAYS", value: stat(engine.serverStats.contribution_days))
                    Divider().frame(height: 44)
                    MetricCell(label: "TODAY", value: stat(engine.serverStats.uploaded_today))
                }
            }

            // The local drain — this device's upload queue with an HONEST ETA
            // from the measured rate (C4: "estimating…" until a real rate exists).
            if engine.backfillRemaining > 0 {
                Text(Self.etaLine(remaining: engine.backfillRemaining,
                                  perMinute: engine.uploadsPerMinute))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            // Last sync line
            HStack {
                if engine.isSyncing {
                    ProgressView()
                        .scaleEffect(0.7)
                    Text("Syncing…")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else if let last = engine.lastSyncDate {
                    Text("Last sync: ")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    + Text(last, style: .relative)
                        .font(.caption2)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                    + Text(" ago")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else {
                    Text("Never synced")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }
        }
        .task {
            // Fetch on appear + keep fresh. Before, the server metrics only
            // refreshed on app-foreground / after sync — so opening Today showed
            // stale "…" with no poll. This loads them now + every 30s while open.
            while !Task.isCancelled {
                await engine.refreshAnalyzedCount()
                try? await Task.sleep(nanoseconds: 30_000_000_000)
            }
        }
    }
}

/// "Your garage" — a horizontal strip of the owner's vehicles, so Today opens
/// onto the actual record (tap → the vehicle's build story). Self-loading via
/// get_user_garage (fast now); renders nothing until it has vehicles.
private struct GarageStrip: View {
    let userId: String
    @State private var garage: [GarageVehicle] = []
    @State private var garageError = false   // a failed load ≠ an empty garage

    var body: some View {
        Group {
            if !garage.isEmpty {
                Section("Your garage") {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(garage) { v in
                                NavigationLink {
                                    VehicleDetailView(vehicleId: v.vehicle_id, embedInNavigationStack: false)
                                } label: {
                                    VStack(alignment: .leading, spacing: 4) {
                                        CachedAsyncImage(url: NukeImage.thumb(v.image_url, width: 220)) { img in
                                            img.resizable().scaledToFill()
                                        } placeholder: {
                                            Color(.secondarySystemFill)
                                                .overlay { Image(systemName: "car.side").foregroundStyle(.secondary) }
                                        }
                                        .frame(width: 104, height: 76)
                                        .clipShape(RoundedRectangle(cornerRadius: 8))
                                        Text(v.title.isEmpty ? "VEHICLE" : v.title)
                                            .font(.caption2).lineLimit(1)
                                            .frame(width: 104, alignment: .leading)
                                            .foregroundStyle(.primary)
                                    }
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                }
            } else if garageError {
                // Failed to load — never the same dead-empty render as "no vehicles".
                Section("Your garage") {
                    HStack {
                        Label("Couldn't load", systemImage: "wifi.exclamationmark")
                            .font(.footnote).foregroundStyle(.secondary)
                        Spacer()
                        Button("Retry") { Task { await load() } }
                            .font(.footnote)
                    }
                }
            }
            // loaded-and-empty → render nothing: Today already shows the funnel,
            // a brand-new owner needs no second empty box here.
        }
        .task(id: userId) { await load() }
    }

    private func load() async {
        garageError = false
        do {
            garage = try await SupabaseService.client
                .rpc("get_user_garage", params: ["p_user_id": userId])
                .execute().value
        } catch {
            garageError = true
            NSLog("NukeCapture Today garage load failed: %@", String(describing: error))
        }
    }
}

private struct MetricCell: View {
    let label: String
    let value: String
    // Optional sub-caption — used only by the ANALYZED drill ("tap to view").
    // Default nil keeps the other three cells untouched / non-tappable.
    var caption: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
                .kerning(0.5)
            Text(value)
                .font(.title2.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(Color.primary)
                .contentTransition(.numericText())
            if let caption {
                HStack(spacing: 3) {
                    Text(caption)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 8, weight: .semibold))
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 4)
    }
}

// ─── Thumbnail strip ─────────────────────────────────────────────────────────

/// Horizontal strip of local PHAsset thumbnails for recently-uploaded photos.
/// Pure PhotoKit — zero network. Identifiers that no longer resolve (user
/// deleted the photo) simply render nothing.
private struct RecentUploadsStrip: View {
    let assetIdentifiers: [String]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(assetIdentifiers, id: \.self) { id in
                    AssetThumbnail(assetIdentifier: id)
                }
            }
        }
        .frame(height: 72)
    }
}

/// Live on-device T0 detections — each pops in as the frame is read (the demo's
/// propagation): the local thumbnail + the detected label + confidence.
private struct LiveT0Strip: View {
    let atoms: [T0Atom]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(atoms) { atom in
                    VStack(spacing: 4) {
                        AssetThumbnail(assetIdentifier: atom.assetID)
                        Text(atom.label.replacingOccurrences(of: "_", with: " "))
                            .font(.caption2).lineLimit(1)
                        Text("\(Int(atom.confidence * 100))%")
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                    .frame(width: 72)
                    .transition(.scale.combined(with: .opacity))
                }
            }
            .padding(.vertical, 2)
        }
        .frame(height: 108)
        .animation(.spring(response: 0.35, dampingFraction: 0.75), value: atoms.count)
    }
}

/// One 64×64 thumbnail, loaded async from PhotoKit.
private struct AssetThumbnail: View {
    let assetIdentifier: String
    @State private var image: UIImage?

    private static let side: CGFloat = 64

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Rectangle()
                    .fill(Color(.secondarySystemFill))
            }
        }
        .frame(width: Self.side, height: Self.side)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .task(id: assetIdentifier) {
            image = await Self.loadThumbnail(for: assetIdentifier)
        }
    }

    /// Fetch the asset by identifier and request a small square thumb.
    /// deliveryMode .highQualityFormat ⇒ the handler fires exactly once, so
    /// the checked continuation cannot double-resume (.opportunistic would
    /// fire twice: degraded then final).
    private static func loadThumbnail(for identifier: String) async -> UIImage? {
        let fetch = PHAsset.fetchAssets(withLocalIdentifiers: [identifier], options: nil)
        guard let asset = fetch.firstObject else { return nil }

        let options = PHImageRequestOptions()
        options.deliveryMode = .highQualityFormat
        options.resizeMode = .fast
        options.isNetworkAccessAllowed = false   // thumbs are local-only; never spend data here

        let scale = await MainActor.run { UIScreen.main.scale }
        let target = CGSize(width: side * scale, height: side * scale)

        return await withCheckedContinuation { continuation in
            PHImageManager.default().requestImage(
                for: asset,
                targetSize: target,
                contentMode: .aspectFill,
                options: options
            ) { image, _ in
                continuation.resume(returning: image)
            }
        }
    }
}
