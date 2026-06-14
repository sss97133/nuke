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
            HStack(spacing: 0) {
                MetricCell(
                    label: "QUEUED",
                    value: "\(engine.backfillRemaining)",
                    hero: engine.backfillRemaining > 0
                )
                Divider().frame(height: 44)
                MetricCell(label: "SYNCED", value: "\(engine.totalSynced)")
            }

            HStack(spacing: 0) {
                MetricCell(label: "TODAY", value: "\(engine.uploadsToday)")
                Divider().frame(height: 44)
                // ANALYZED drills into the evidence behind the count: the
                // analyzed photos + their extracted atoms. Tappable only when
                // there's something to show; at 0 it stays the static "—" cell.
                if engine.analyzedCount > 0 {
                    NavigationLink {
                        AnalyzedPhotosView(userId: SupabaseService.currentUserId ?? "")
                    } label: {
                        MetricCell(
                            label: "ANALYZED",
                            value: "\(engine.analyzedCount)",
                            caption: "tap to view"
                        )
                    }
                    .buttonStyle(.plain)
                } else {
                    MetricCell(label: "ANALYZED", value: "—")
                }
            }

            // Queue drain progress bar — visible while backfill is active: the
            // screen-off drain made legible (the pour is the show).
            if engine.backfillRemaining > 0 || engine.totalSynced > 0 {
                DrainBar(remaining: engine.backfillRemaining, synced: engine.totalSynced)
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
