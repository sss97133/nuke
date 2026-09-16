// TodayView.swift — the ENGINE (was "Today"). The engine room, not a daily feed.
//
// Why the rename: "Today" was the cloud-relay paradigm's window — watch every photo
// ship to the cloud and get analyzed there. In the local-first model (the library
// lives on-device, the agent reads it locally, pixels escalate only on the owner's
// say-so) that framing is obsolete, and a tab named "Today" that reads 0 most days is
// a lie. Its real, honest job is two things:
//   • the WORKLIGHT — the agent reading your photos, live (LiveAnalysisStream + the
//     on-device T0 reads). Motion = trust; this is the part that's actually alive.
//   • the WORKBENCH — the operator's tools (sync, analyze, repair, confirm). The
//     reason the tab earns its keep: a home to develop and run capabilities.
// The record itself (day-stories, understood days) lives in Profile / the day receipt,
// not here. The struct name stays TodayView to avoid a churny rename; the tab is "Engine".

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

                // Pulled from the Engine on purpose:
                //  • UnderstandingPanel — its "latest understood" day-stories are the
                //    RECORD, not the live moment (and rendered 12 days stale here). They
                //    belong in the day receipt / Profile, where a record is read.
                //  • Recent uploads — it surfaced personal photos (a newborn) the
                //    backfill is shipping to the cloud. Hiding the strip doesn't un-ship
                //    them; the real fix is the upload gate (the backfill must respect the
                //    local-first site/ownership gate, not brute-force the whole library).
                //    That's an ownership decision (what leaves the device) — Skylar's call.

                // ── Tools · the workbench ── the operator levers. This is the honest
                // reason the Engine tab earns its place: a home to develop + run tools.
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

                    // Repair photo dates — re-reads each synced asset's true EXIF
                    // (DateTimeOriginal + GPS) on-device and patches rows that an
                    // older build stamped with the iCloud re-add date. One-shot.
                    Button {
                        Task { await engine.reconcileLibrary() }
                    } label: {
                        if engine.isReconciling {
                            Label(engine.reconcileStatus.isEmpty ? "Repairing…" : engine.reconcileStatus,
                                  systemImage: "calendar.badge.clock")
                        } else {
                            Label("Repair photo dates", systemImage: "calendar.badge.clock")
                        }
                    }
                    .disabled(engine.isReconciling)

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
                } header: {
                    Label("Tools", systemImage: "wrench.and.screwdriver")
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
            .navigationTitle("Engine")
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

/// The funnel: local LIBRARY/RELEVANT (ignition scan) over the server record
/// UPLOADED/DAYS/TODAY (get_user_capture_stats). The whole block taps to the
/// on-device day-by-day record (LibraryDaysView) — built from LocalStore, renders
/// with the network OFF. The old ANALYZED cell drilled into AnalyzedPhotosView; that
/// analyze pipeline is deprecated/halted, and because it was the ONLY NavigationLink
/// in this single List row, a tap anywhere in the strip fired it (the "everything
/// pushes to analyzed" bug). Removed — the tap now goes to the live local record.
private struct LiveMetricsStrip: View {
    @ObservedObject var engine: SyncEngine
    @State private var showDays = false

    /// The funnel numbers — pure display; the tap target is owned by the caller below.
    @ViewBuilder private var metricsFunnel: some View {
        VStack(spacing: 14) {
            // The owner's own library, organized (C2): LIBRARY = whole on-device count
            // from the ignition scan; RELEVANT = the confirmed at-site set.
            if engine.libraryTotal > 0 {
                HStack(spacing: 0) {
                    MetricCell(label: "LIBRARY", value: "\(engine.libraryTotal)")
                    Divider().frame(height: 44)
                    MetricCell(label: "RELEVANT", value: "\(engine.relevantTotal)")
                }
            }
            // Server truth. Until the first load lands (~9s cold) cells read "…", never
            // a fake "0" (a 0 reads as a dead, empty record — it isn't).
            HStack(spacing: 0) {
                MetricCell(label: "UPLOADED", value: stat(engine.serverStats.total_images))
                Divider().frame(height: 44)
                MetricCell(label: "DAYS", value: stat(engine.serverStats.contribution_days))
                Divider().frame(height: 44)
                MetricCell(label: "TODAY", value: stat(engine.serverStats.uploaded_today))
            }
        }
    }

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
            // THE RECORD. A FAILED first server load shows a retry (the local funnel
            // still renders); otherwise the whole block taps to the on-device
            // day-by-day record — network-free, the live destination.
            if engine.statsError && !engine.statsLoaded {
                metricsFunnel
                HStack {
                    Label("Couldn't load your record", systemImage: "wifi.exclamationmark")
                        .font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("Retry") { Task { await engine.refreshAnalyzedCount() } }
                        .font(.caption)
                }
            } else {
                Button { showDays = true } label: { metricsFunnel }
                    .buttonStyle(.plain)
                Text("Your record · tap for the day-by-day")
                    .font(.caption2).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
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
        // The on-device day-by-day record (LibraryDaysView reads LocalStore — no
        // network). Owns its own NavigationStack + Done, so present as a sheet.
        .sheet(isPresented: $showDays) { LibraryDaysView() }
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
