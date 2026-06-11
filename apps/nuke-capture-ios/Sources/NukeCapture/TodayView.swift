// TodayView.swift — the native value screen.
//
// This is what the app *is* to a reviewer and to the owner: live capture
// telemetry rendered from on-device state (PhotoKit thumbnails, sync
// counters) — none of which a web page can do. Specifically:
//
//   • uploads today / total synced / held-back (off-shop) counts
//   • last-sync time + manual Sync Now (also pull-to-refresh)
//   • recent-uploads thumbnail strip rendered from LOCAL PHAssets
//   • "View on Nuke" link out to the owner's profile on nuke.ag
//
// Plain system styling (SF/system font, default List) — clean and honest,
// nothing for review to flag.

import SwiftUI
import Photos

struct TodayView: View {
    @ObservedObject private var engine = SyncEngine.shared
    @State private var showAccount = false

    var body: some View {
        NavigationStack {
            List {
                // ── Status / errors ──
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

                // ── Today ──
                Section("Today") {
                    LabeledContent("Uploaded today") {
                        Text("\(engine.uploadsToday)")
                            .font(.title2.weight(.semibold))
                            .monospacedDigit()
                    }
                    // The consent surface: backfill/sync run automatically;
                    // this is the hand on the valve.
                    Toggle("Uploads", isOn: Binding(
                        get: { !engine.isPaused },
                        set: { engine.setPaused(!$0) }
                    ))
                    // Ignition backfill draining — row exists only while
                    // the queue does.
                    if engine.backfillRemaining > 0 {
                        LabeledContent("Backfill queued") {
                            Text("\(engine.backfillRemaining)")
                                .monospacedDigit()
                        }
                    }
                    LabeledContent("Last sync") {
                        if engine.isSyncing {
                            ProgressView()
                        } else if let last = engine.lastSyncDate {
                            Text(last, style: .relative) + Text(" ago")
                        } else {
                            Text("never")
                        }
                    }
                }

                // ── All time ──
                Section {
                    LabeledContent("Photos synced") {
                        Text("\(engine.totalSynced)").monospacedDigit()
                    }
                    LabeledContent("Held back (off-site)") {
                        Text("\(engine.totalSkippedOffShop)").monospacedDigit()
                    }
                } header: {
                    Text("All time")
                } footer: {
                    // The privacy story, stated where the user (and the App
                    // Review reader) can see it every day.
                    Text("Only photos taken at your registered work locations upload. Everything else stays on this phone — held-back photos are counted, never sent.")
                }

                // ── Recent uploads (local thumbnails) ──
                if !engine.recentUploadIDs.isEmpty {
                    Section("Recent uploads") {
                        RecentUploadsStrip(assetIdentifiers: engine.recentUploadIDs)
                            .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                    }
                }

                // ── Actions ──
                Section {
                    Button {
                        Task { await engine.sync() }
                    } label: {
                        Label("Sync Now", systemImage: "arrow.triangle.2.circlepath")
                    }
                    .disabled(engine.isSyncing)

                    Link(destination: Config.profileURL) {
                        Label("View on Nuke", systemImage: "safari")
                    }
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
