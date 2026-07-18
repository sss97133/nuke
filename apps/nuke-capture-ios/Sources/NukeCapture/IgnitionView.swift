// IgnitionView.swift — the first-run sequence: scan → site confirm → done
// (backfill starts automatically; the gauge + pause toggle in Today is the
// consent surface).
//
// Styling doctrine (founder ruling, 2026-06-11): STOCK native iOS appearance
// — system backgrounds, system type, default List/controls. The only custom
// treatment is monospaced digits on data values. All effort goes into the
// windows-into-data-flow: the counter ticking as the library is read, thumbs
// landing in the grid as they're found, gauges appearing the moment their
// data exists. Copy is instrument register: counts, names, timestamps,
// one-word imperatives — the app reports, it never explains.
//
// Permission action tree — theory: MAXIMUM VISIBILITY to the source library, so
// full access is the only resting state:
//   Allow Full Access → full scan (ScanScreen)
//   Limit Access      → LimitedScreen: a slice is not the library; escalate to
//                       Full Access in Settings (supersedes the 2026-06-11 no-nag)
//   Don't Allow       → truthful empty state (Settings) — DeniedScreen

import Photos
import PhotosUI
import SwiftUI

struct IgnitionView: View {
    @ObservedObject private var engine = IgnitionEngine.shared

    var body: some View {
        NavigationStack {
            Group {
                switch engine.phase {
                case .intro:
                    // The one orientation a stranger needs, before the scan +
                    // the system permission prompt. Begin starts the engine.
                    IntroScreen(engine: engine)
                case .scanning:
                    ScanScreen(engine: engine)
                case .site:
                    SiteScreen(engine: engine)
                case .empty:
                    EmptyScreen(engine: engine)
                case .denied:
                    DeniedScreen(engine: engine)
                case .limited:
                    LimitedScreen(engine: engine)
                }
            }
            .navigationTitle("Nuke")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

// ─── Intro: the one line that turns a confused stranger into a believer ─────
// The app's register is "report, never explain" — earned once the user knows
// what Nuke IS. This single screen states the thesis, then gets out of the way.

private struct IntroScreen: View {
    @ObservedObject var engine: IgnitionEngine

    var body: some View {
        List {
            Section {
                Text("The photos you already take of your vehicle become its verified history — and its worth.")
                    .font(.title3.weight(.medium))
                    .padding(.vertical, 6)
            }
            Section {
                LabeledContent("Next", value: "Scan this device for your shop")
                LabeledContent("Uploads", value: "None until you confirm")
            } footer: {
                Text("On the next prompt, choose Allow Full Access — Nuke reads your whole library on-device to build your record. A limited selection hides most of it.")
            }
            Section {
                Button {
                    Task { await engine.start() }
                } label: {
                    Text("Begin")
                        .frame(maxWidth: .infinity)
                        .fontWeight(.semibold)
                }
                .buttonStyle(.borderedProminent)
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            }
        }
        .task {
            // Headless screenshot/demo walk auto-begins so the full ignition
            // can be driven without a tap. DEBUG only.
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-IgnitionDemoWalk") {
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                await engine.start()
            }
            #endif
        }
    }
}

// ─── Empty: the scan found no located photos — the truth, not a blank app ───

private struct EmptyScreen: View {
    @ObservedObject var engine: IgnitionEngine

    var body: some View {
        List {
            Section {
                Text("No located photos found.")
                    .font(.title3.weight(.medium))
            } footer: {
                Text("Nuke finds your shop from photo location data. Turn it on for your camera — Settings › Privacy › Location Services › Camera › While Using — then shoot a few photos at your work site.")
            }
            Section {
                LabeledContent("Scanned") {
                    Text("\(engine.totalToRead)").monospacedDigit()
                }
                LabeledContent("Located") {
                    Text("0").monospacedDigit()
                }
            }
            Section {
                Button {
                    engine.continueFromEmpty()
                } label: {
                    Text("Continue")
                        .frame(maxWidth: .infinity)
                        .fontWeight(.semibold)
                }
                .buttonStyle(.borderedProminent)
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            }
        }
        .task {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-IgnitionDemoWalk") {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                engine.continueFromEmpty()
            }
            #endif
        }
    }
}

// ─── Scan: the counter rips, the grid floods, the gauge reads 0 ─────────────

private struct ScanScreen: View {
    @ObservedObject var engine: IgnitionEngine
    @ObservedObject private var sync = SyncEngine.shared

    private var fraction: Double {
        engine.totalToRead > 0
            ? Double(engine.photosRead) / Double(engine.totalToRead) : 0
    }

    var body: some View {
        List {
            Section {
                HStack(alignment: .firstTextBaseline) {
                    // The counter — photos read off the library, live.
                    Text("\(engine.photosRead)")
                        .font(.system(size: 56, weight: .semibold))
                        .monospacedDigit()
                        .contentTransition(.numericText())
                        .animation(.linear(duration: 0.05), value: engine.photosRead)
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                    Spacer()
                    // The privacy proof: the real upload count, watched
                    // while the read counter passes thousands.
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("Uploaded")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text("\(sync.totalSynced)")
                            .font(.title3.weight(.semibold))
                            .monospacedDigit()
                    }
                }
                .padding(.vertical, 4)

                ProgressView(value: fraction)

                // Gauges power on the moment their data exists.
                if engine.gpsPhotosFound > 0 {
                    LabeledContent("Located") {
                        Text("\(engine.gpsPhotosFound)").monospacedDigit()
                    }
                }
            }

            if !engine.floodAssetIDs.isEmpty {
                Section {
                    FloodGrid(assetIDs: engine.floodAssetIDs)
                        .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                }
            }
        }
    }
}

// ─── Limited: a hand-picked slice is not the library — escalate to Full ──────
// Theory: maximum visibility to the source. Limited access is the opposite, so
// it is a state to FIX, not a ledger fact to report. The one action is Full
// Access in Settings; on return, ignition re-checks and proceeds if granted.

private struct LimitedScreen: View {
    @ObservedObject var engine: IgnitionEngine
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        List {
            Section {
                Text("Nuke can only see the photos you picked.")
                    .font(.title3.weight(.medium))
            } footer: {
                Text("Your full library is hidden. Nuke needs Full Access to build your vehicles' record from everything you've shot — Settings › Nuke › Photos › All Photos.")
            }
            Section {
                Button {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                } label: {
                    Text("Grant Full Access")
                        .frame(maxWidth: .infinity)
                        .fontWeight(.semibold)
                }
                .buttonStyle(.borderedProminent)
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            }
        }
        .onChange(of: scenePhase) { _, phase in
            // Back from Settings → re-check; Full Access now → ignite.
            if phase == .active { Task { await engine.retryAfterSettings() } }
        }
    }
}

// ─── Site: the cluster reported, the cursor handed over ─────────────────────

private struct SiteScreen: View {
    @ObservedObject var engine: IgnitionEngine

    var body: some View {
        if let cand = engine.currentCandidate {
            List {
                Section {
                    LabeledContent("Photos") {
                        Text("\(cand.photoCount)").monospacedDigit()
                    }
                    LabeledContent("Days") {
                        Text("\(cand.dayCount)").monospacedDigit()
                    }
                    LabeledContent("Years") {
                        Text(cand.yearRange).monospacedDigit()
                    }
                    LabeledContent("Center") {
                        Text(String(format: "%.4f, %.4f", cand.centerLat, cand.centerLon))
                            .monospacedDigit()
                    }
                    LabeledContent("Radius") {
                        Text("\(Int(cand.radiusMeters * 3.28084)) ft").monospacedDigit()
                    }
                } header: {
                    Text(engine.candidates.count == 1
                         ? "One site"
                         : String(format: "Site %02d of %02d",
                                  engine.candidateIndex + 1, engine.candidates.count))
                } footer: {
                    Text("A site is a place you work on vehicles. Confirm it and photos shot here become your vehicle's record.")
                }

                // One-tap decision — no naming field (the name defaults to
                // SITE NN; renaming is optional, later, in Account). The
                // founder-rejected text gate stays gone.
                Section {
                    LabeledContent(String(format: "SITE %02d", engine.siteOrdinal)) {
                        Text("This site only")
                    }
                }

                Section {
                    FloodGrid(assetIDs: cand.assets.suffix(8).map(\.id))
                        .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                }

                Section {
                    Button {
                        engine.confirmCurrentSite()
                    } label: {
                        Text("That's my shop")
                            .frame(maxWidth: .infinity)
                            .fontWeight(.semibold)
                    }
                    .buttonStyle(.borderedProminent)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)

                    Button {
                        engine.rejectCurrentSite()
                    } label: {
                        Text("Not mine")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                }
            }
        }
    }
}

// ─── Denied: the truthful empty state ────────────────────────────────────────

private struct DeniedScreen: View {
    @ObservedObject var engine: IgnitionEngine
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        List {
            Section {
                LabeledContent("Photos") {
                    Text("Off")
                }
            }
            Section {
                Button("Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            // Back from Settings → re-check; if access now exists, ignite.
            if phase == .active {
                Task { await engine.retryAfterSettings() }
            }
        }
    }
}

// ─── Shared pieces ───────────────────────────────────────────────────────────

/// Square thumbnail grid fed by PHCachingImageManager — photos land here as
/// the scan finds them.
struct FloodGrid: View {
    let assetIDs: [String]
    var columns: Int = 4

    var body: some View {
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: columns),
            spacing: 2
        ) {
            ForEach(assetIDs, id: \.self) { id in
                IgnitionThumb(assetID: id)
            }
        }
    }
}

/// One square local thumbnail. Never hits the network — ignition reads the
/// library, it does not spend data.
struct IgnitionThumb: View {
    let assetID: String
    @State private var image: UIImage?

    var body: some View {
        Color(.secondarySystemFill)
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                }
            }
            .clipped()
            .task(id: assetID) {
                image = await ThumbLoader.load(assetID)
            }
    }
}

/// Shared PHCachingImageManager front. deliveryMode .highQualityFormat ⇒
/// exactly one callback, so the continuation cannot double-resume.
enum ThumbLoader {
    private static let manager = PHCachingImageManager()

    static func load(_ identifier: String, side: CGFloat = 200) async -> UIImage? {
        let fetch = PHAsset.fetchAssets(withLocalIdentifiers: [identifier], options: nil)
        guard let asset = fetch.firstObject else { return nil }

        let options = PHImageRequestOptions()
        options.deliveryMode = .highQualityFormat
        options.resizeMode = .fast
        options.isNetworkAccessAllowed = false

        return await withCheckedContinuation { continuation in
            manager.requestImage(
                for: asset,
                targetSize: CGSize(width: side, height: side),
                contentMode: .aspectFill,
                options: options
            ) { image, _ in
                continuation.resume(returning: image)
            }
        }
    }
}

