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
    @State private var showAccount = false

    var body: some View {
        NavigationStack {
            List {
                // ── Errors / permission banner ──
                if engine.authorizationDenied {
                    Section {
                        Label(
                            "Photos access is off. Enable it in Settings → Privacy & Security → Photos → Nuke.",
                            systemImage: "exclamationmark.triangle"
                        )
                        .font(.footnote)
                        .foregroundStyle(.orange)
                    }
                } else if let error = engine.lastError {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle")
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

                    // Pause toggle — secondary; the big numbers are the hero
                    Toggle("Uploads", isOn: Binding(
                        get: { !engine.isPaused },
                        set: { engine.setPaused(!$0) }
                    ))
                } footer: {
                    // Privacy story: one line instead of a paragraph
                    let held = engine.totalSkippedOffShop
                    Text("On-site photos only · \(held) held back")
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
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
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
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(d.frames ?? 0) frames")
                    .font(.caption2).monospacedDigit()
                    .foregroundStyle(.secondary)
                Text(d.date)
                    .font(.caption2).monospacedDigit()
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 2)
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
        do {
            let rows: [UserUnderstanding] = try await SupabaseService.client
                .rpc("get_user_understanding", params: ["p_user_id": userId])
                .execute()
                .value
            if let row = rows.first {
                withAnimation(.easeInOut(duration: 0.4)) { u = row }
            }
        } catch {
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

    var body: some View {
        VStack(spacing: 14) {
            // THE REAL RECORD — server truth (get_user_capture_stats), not
            // this device's local counters. IMAGES is the full ~22K library.
            HStack(spacing: 0) {
                MetricCell(label: "IMAGES", value: "\(engine.serverStats.total_images)")
                Divider().frame(height: 44)
                // ANALYZED drills into the analyzed photos + their atoms.
                if engine.serverStats.analyzed > 0 {
                    NavigationLink {
                        AnalyzedPhotosView(userId: SupabaseService.currentUserId ?? "")
                    } label: {
                        MetricCell(
                            label: "ANALYZED",
                            value: "\(engine.serverStats.analyzed)",
                            caption: "tap to view"
                        )
                    }
                    .buttonStyle(.plain)
                } else {
                    MetricCell(label: "ANALYZED", value: "—")
                }
            }

            HStack(spacing: 0) {
                MetricCell(label: "DAYS", value: "\(engine.serverStats.contribution_days)")
                Divider().frame(height: 44)
                MetricCell(label: "TODAY", value: "\(engine.serverStats.uploaded_today)")
            }

            // The local drain — this device's upload queue, honestly labeled
            // (not a headline number). Only while backfill is in flight.
            if engine.backfillRemaining > 0 {
                Text("Uploading \(engine.backfillRemaining) from this device…")
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
    }
}

private struct MetricCell: View {
    let label: String
    let value: String
    // QUEUED becomes the heavy hero while the drain is live.
    var hero: Bool = false
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
                .font(hero ? .title.weight(.heavy) : .title2.weight(.semibold))
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

/// Thin horizontal bar draining left→right as QUEUED approaches zero.
private struct DrainBar: View {
    let remaining: Int
    let synced: Int

    private var fraction: Double {
        let total = remaining + synced
        guard total > 0 else { return 1.0 }
        return Double(synced) / Double(total)
    }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Rectangle()
                    .fill(Color.primary.opacity(0.08))
                Rectangle()
                    .fill(Color.primary.opacity(0.5))
                    .frame(width: geo.size.width * fraction)
                    .animation(.easeInOut(duration: 0.4), value: fraction)
            }
        }
        .frame(height: 2)
        .clipShape(Capsule())
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
